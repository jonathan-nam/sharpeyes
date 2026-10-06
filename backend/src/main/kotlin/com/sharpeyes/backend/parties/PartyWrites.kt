package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.CharacterBossSkip
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.greaterEq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Writes behind /api/parties and /api/people. Inside a transaction, on input the route has
// already validated.

internal fun createParty(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    // character name -> sprite the Nexon lookup found, or null when it came back empty.
    sprites: Map<String, String?> = emptyMap(),
): Uuid {
    // A config for this pair says the character runs the boss, so any "doesn't run" mark on it is
    // now wrong. The config is the more detailed statement of the two, so it wins. The skip route
    // refuses the opposite order (see RoutineRefusal.HasParty), which leaves one way for the two to
    // disagree and one answer to it.
    CharacterBossSkip.deleteWhere {
        (CharacterBossSkip.characterId eq characterId) and (CharacterBossSkip.bossCatalogId eq bossCatalogId)
    }
    val partyId = Uuid.random()
    Party.insert {
        it[id] = partyId
        it[Party.userId] = userId
        it[Party.characterId] = characterId
        it[Party.bossCatalogId] = bossCatalogId
        it[difficulty] = request.difficulty
        it[minutes] = request.minutes
        it[oneOff] = request.oneOff
        it[createdAt] = now
        it[updatedAt] = now
    }
    // A one-off is off in every period but the ones it is armed for, so the period it was made in
    // has to be one of them. Without this it would be created already gone.
    if (request.oneOff) {
        val period = periodShown(bossResetOf(bossCatalogId)!!, week = null, now = now)
        setRunsInPeriod(partyId, oneOff = true, period, runs = true, now = now)
    }
    val context = SeatContext(userId, sprites, now)
    writeMembers(partyId, characterId, request.members, context, request.shares)
    if (request.oneOff) writeNightRoster(partyId, characterId, request.members, now, context)
    return partyId
}

/**
 * Replaces the config's difficulty, run time and members.
 *
 * The character and the boss are not editable: they are what the config IS, and changing either
 * would silently turn "Kalos on mechyfechy" into a different question with the same loot pool
 * hanging off it. Delete it and make the other one instead. The difficulty is editable, because a
 * party that starts clearing Chaos is the same party.
 *
 * Seats are matched to existing rows by character NAME, so correcting a label or reordering the
 * list keeps the row a loot payout points at.
 */
internal fun saveParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    val characterId =
        Party
            .selectAll()
            .where { (Party.id eq partyId) and (Party.userId eq userId) }
            .first()[Party.characterId]
    Party.update({ (Party.id eq partyId) and (Party.userId eq userId) }) {
        it[difficulty] = request.difficulty
        it[minutes] = request.minutes
        it[updatedAt] = now
    }
    // Nobody else left in it, so it is not a party any more. The config becomes the solo pool it
    // now is: off Party View, on every period, holding every drop it already had. Refusing the edit
    // instead would leave you deleting the config to say it, and deleting takes the pool with it.
    // See soloAgain, which is the same move a spent night makes.
    if (request.members.isEmpty()) {
        soloAgain(userId, partyId, characterId, bossResetOf(bossIdOfParty(partyId)!!)!!, now)
    } else {
        writeMembers(partyId, characterId, request.members, SeatContext(userId, sprites, now), request.shares)
    }
}

/**
 * Marks this config's boss cleared, or not, for the period it is currently in.
 *
 * Writes boss_clear, which is what makes the two pages agree: the clear matrix reads this row and
 * a planner capture overwrites it. There is one answer to "is Kalos done this week", and ticking
 * it here is another way of saying it rather than a second place to keep it.
 *
 * source_screenshot_id is left null on purpose. It is what tells a hand-tick from a capture later,
 * and the next capture will replace this row with one that has a screenshot behind it.
 */
internal fun setPartyClear(
    party: PartyResponse,
    bossCatalogId: Uuid,
    reset: String,
    cleared: Boolean,
    now: Instant,
) {
    BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { row ->
        row[characterId] = Uuid.parse(party.characterId)
        row[BossClear.bossCatalogId] = bossCatalogId
        row[periodStart] = periodStartFor(reset, now)
        row[BossClear.cleared] = cleared
        row[capturedAt] = now
        row[sourceScreenshotId] = null
    }
    // What the clear guarantees on a boss run alone, or taking it back. Nothing for a party, whose
    // coupons are typed: the gate is lootFromClear's. See LootFromClear.kt.
    val own = Uuid.parse(party.characterId)
    val today = todayIn(now)
    if (cleared) {
        lootFromClear(own, bossCatalogId, reset, today, now)
    } else {
        unlootFromClear(own, bossCatalogId, reset, today)
    }
}

/** Today, as the clock the periods are measured on sees it. */
internal fun todayIn(now: Instant): LocalDate = now.toLocalDateTime(TimeZone.UTC).date

/**
 * The clear a drop implies: something fell, so the boss died.
 *
 * Only ever writes true, and only over silence or a "not cleared". A clear already recorded is
 * left alone rather than rewritten, which is what keeps the screenshot behind a captured one and
 * stops it being relabelled as a hand tick.
 *
 * The period is the DROP'S, not today's. A drop carries the date it fell on, so filing the clear
 * against the day the request arrived would tick this week for a kill in the last one. That also
 * makes this the one clear a past period can gain: unlike a tick, a drop says which period it
 * belongs to.
 *
 * Nothing here goes the other way. Deleting the drop does not un-clear the boss, since removing
 * the record of what fell says nothing about whether it died.
 */
internal fun clearFromDrop(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    droppedOn: LocalDate,
    now: Instant,
) {
    val period = periodOf(reset, droppedOn)
    val already =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq characterId) and
                    (BossClear.bossCatalogId eq bossCatalogId) and
                    (BossClear.periodStart eq period)
            }.firstOrNull()
            ?.get(BossClear.cleared) == true
    if (already) return

    BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { row ->
        row[BossClear.characterId] = characterId
        row[BossClear.bossCatalogId] = bossCatalogId
        row[periodStart] = period
        row[cleared] = true
        row[capturedAt] = now
        row[sourceScreenshotId] = null
    }
}

/** What taking a config off Party View did to it. */
internal enum class Removal {
    DELETED,
    RETIRED,
    NOT_FOUND,
}

/**
 * Takes this config off the lists, keeping its pool if it has one.
 *
 * A config that has ever held a drop is RETIRED rather than deleted. party_loot cascades off it and
 * party_loot_payout off that, so deleting it would erase a settled split, and un-owe an outstanding
 * one, in the same breath as tidying up a boss nobody runs any more.
 *
 * This is retireOrDelete's rule one level up, and the reasoning there applies unchanged: a row
 * nothing points at is deleted, so a config made by mistake does not sit retired forever.
 *
 * All time, not the shown week. A settled drop from months ago is exactly the record this keeps.
 *
 * The tick this period goes first, so what is left is what somebody actually entered. See
 * withdrawClear: a config whose only drop was one a clear filed for it is a config nothing points
 * at, and is deleted rather than retired over a row the app wrote itself.
 */
internal fun retireOrDeleteParty(
    partyId: Uuid,
    userId: String,
    now: Instant,
): Removal =
    when {
        !ownsParty(partyId, userId) -> Removal.NOT_FOUND
        else -> {
            withdrawClear(partyId, now)
            if (PartyLoot.selectAll().where { PartyLoot.partyId eq partyId }.empty()) {
                Party.deleteWhere { (Party.id eq partyId) and (Party.userId eq userId) }
                Removal.DELETED
            } else {
                Party.update({ (Party.id eq partyId) and (Party.userId eq userId) }) { it[standing] = false }
                Removal.RETIRED
            }
        }
    }

/**
 * Takes a one-off's night back: its drops for [period], and the config once nothing points at it.
 *
 * The inverse of the rule above, because a one-off is a night rather than an arrangement. Taking it
 * off its period says the night did not happen, and a pool for a night that did not happen is a
 * count nobody can trace: the Sale Ledger reads pools without the run marks, so 60 coupons sat under
 * a Hard Limbo that was gone from every page which could have explained them.
 *
 * EVERYTHING the period holds, not only what a clear filed, and a sold row is not spared. Deleting a
 * drop one at a time already takes its payouts and its bundles with it (see deleteLoot), so this is
 * that button applied to the night rather than a new way to lose a settled split.
 *
 * One way. Arming the config again gives an empty pool to type into, because nothing here can know
 * which of the drops that were there fell on the night being put back.
 *
 * Returns true when the config went too, which is retireOrDeleteParty's rule unchanged: a row
 * nothing points at is deleted. Earlier periods keep it alive, since running the same boss again
 * arms the config it already has rather than making a second one.
 *
 * A standing party never reaches here. See setSkipRoute, which is the only caller.
 */
internal fun retractNight(
    partyId: Uuid,
    reset: String,
    period: LocalDate,
): Boolean {
    val nextPeriod = periodAfter(reset, period)
    PartyLoot.deleteWhere {
        (PartyLoot.partyId eq partyId) and
            (PartyLoot.droppedOn greaterEq period) and
            (PartyLoot.droppedOn less nextPeriod)
    }
    if (!PartyLoot.selectAll().where { PartyLoot.partyId eq partyId }.empty()) return false
    Party.deleteWhere { Party.id eq partyId }
    return true
}

/**
 * Writes the USUAL seats, YOUR character first.
 *
 * The API takes the others, because that is what you type: the config already knows whose it is.
 * Your character is stored as a seat anyway, and that is not bookkeeping for its own sake. A loot
 * pool's payouts point at seats, and you are usually the one who sold the drop, so leaving
 * yourself out would make the seller of most drops unnameable.
 *
 * Seats are matched by NAME, guests included, so promoting somebody who has been guesting names
 * the seat they already have rather than a second one under the same name.
 */
internal fun writeMembers(
    partyId: Uuid,
    ownCharacterId: Uuid,
    members: List<String>,
    context: SeatContext,
    // What each seat usually takes, by character name. A name left out takes one: the roster passed
    // in is the whole party, so absence is the answer rather than a gap to preserve.
    shares: Map<String, Int> = emptyMap(),
) {
    val names = seatNames(ownSeatName(ownCharacterId), members)
    val sharesByName = shares.mapKeys { (name, _) -> name.trim().lowercase() }
    val wanted = names.associate { it.lowercase() to (sharesByName[it.lowercase()] ?: 1) }

    // Before the party moves, freeze the roster onto every week already written into, and the split
    // onto the settled ones. A week with no rows of its own is read as whoever is in the party
    // today, and entitlement is derived from party_member.shares on read, so without this an edit
    // rewrites nights already played. Which weeks each of the two reaches is pinWeeksAlreadyWritten's
    // to say. Here rather than at the callers: this is the one place a standing roster is written,
    // and a second caller that forgot would be silent.
    pinWeeksAlreadyWritten(partyId, wanted, context.now)

    val existing = seatIdsByName(partyId)

    val kept = names.mapNotNull { existing[it.lowercase()] }.toSet()
    retireOrDelete(partyId, existing.values.filterNot { it in kept })

    val mine = ownCharacterIds(context.userId)

    names.forEachIndexed { index, name ->
        val characterId = mine[name.lowercase()]
        val looked = characterId == null && context.sprites.containsKey(name)
        val seatId = existing[name.lowercase()]
        val seatShares = wanted.getValue(name.lowercase())
        if (seatId == null) {
            insertSeat(partyId, name, characterId, index, NewSeat(standing = true, shares = seatShares), context)
        } else {
            PartyMember.update({ PartyMember.id eq seatId }) {
                it[PartyMember.name] = name
                it[PartyMember.characterId] = characterId
                it[position] = index
                it[PartyMember.shares] = seatShares
                // A guest named in the usual roster is joining it for good.
                it[standing] = true
                // Left alone unless this character was looked up just now, or the seat became one
                // of yours. Otherwise a save that only reorders seats would wipe every sprite.
                if (characterId != null) {
                    it[spriteImgUrl] = null
                    it[spriteRefreshedAt] = null
                } else if (looked) {
                    it[spriteImgUrl] = context.sprites[name]
                    it[spriteRefreshedAt] = context.now
                }
            }
        }
    }
}

/**
 * Replaces the people list and every character attributed to them.
 *
 * Configs are untouched: they name characters, and this only says whose those characters are. So
 * removing a person leaves every seat exactly where it was, showing no owner.
 */
internal fun savePeople(
    userId: String,
    request: SavePeopleRequest,
    now: Instant,
) {
    val kept = mutableListOf<Uuid>()
    for (person in request.people) {
        val name = person.name.trim()
        val existing = person.id?.let(Uuid::parseOrNull)
        val personId =
            if (existing == null) {
                val id = Uuid.random()
                Person.insert {
                    it[Person.id] = id
                    it[Person.userId] = userId
                    it[Person.name] = name
                    it[createdAt] = now
                    it[updatedAt] = now
                }
                id
            } else {
                Person.update({ (Person.id eq existing) and (Person.userId eq userId) }) {
                    it[Person.name] = name
                    it[updatedAt] = now
                }
                existing
            }
        kept += personId

        PersonCharacter.deleteWhere { PersonCharacter.personId eq personId }
        person.characters
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinctBy { it.lowercase() }
            .forEach { character ->
                PersonCharacter.insert {
                    it[PersonCharacter.id] = Uuid.random()
                    it[PersonCharacter.personId] = personId
                    it[PersonCharacter.userId] = userId
                    it[PersonCharacter.name] = character
                }
            }
    }

    val doomed =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .map { it[Person.id] }
            .filterNot { it in kept }
    if (doomed.isNotEmpty()) Person.deleteWhere { Person.id inList doomed }
}
