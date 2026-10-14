package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.bossClearedOn
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.tokens.syncPiecesForClear
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The config for a boss run alone. Held apart from PartyWrites.kt because a solo pool is the one
// config that is not a party, and every rule that makes it one lives here: how a drop finds it, how
// it is opened, and what has to be pinned before it becomes an ordinary party.
//
// Inside a transaction, like the rest. See V30__party_solo.sql.

/**
 * The config this character has for this boss, party or solo, or null when there is none.
 *
 * What "log a drop on this boss" resolves to. One config per pair (see V22__party_config.sql), so
 * this cannot be a choice between two.
 */
internal fun partyIdFor(
    characterId: Uuid,
    bossCatalogId: Uuid,
): Uuid? =
    Party
        .selectAll()
        .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
        .firstOrNull()
        ?.get(Party.id)

/** True when this config has one seat because nobody else was there. */
internal fun isSoloParty(partyId: Uuid): Boolean =
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Party.solo) == true

/**
 * Opens the pool for a boss this character ran alone.
 *
 * One seat, so a drop has an owner to be sold by and the split has a party to be read against. It
 * is not a party and does not claim to be one: no difficulty (nobody said), no run time, and off
 * every list of parties.
 *
 * The "doesn't run" mark, if there is one, is left alone on purpose. A boss killed once is not a
 * boss added to the routine, and addLoot's clear already shows this week's tick over the mark. See
 * setBossRoutine.
 */
internal fun createSoloParty(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    now: Instant,
): Uuid {
    val partyId = Uuid.random()
    Party.insert {
        it[id] = partyId
        it[Party.userId] = userId
        it[Party.characterId] = characterId
        it[Party.bossCatalogId] = bossCatalogId
        it[solo] = true
        it[createdAt] = now
        it[updatedAt] = now
    }
    writeMembers(partyId, characterId, emptyList(), SeatContext(userId, emptyMap(), now))
    return partyId
}

/**
 * The pool a drop on this character and boss belongs in, opened if it is not there yet.
 *
 * The config this character has for the boss takes it, party or solo, so logging a drop from the
 * Drop Log cannot open a second pool beside the party's. One config per pair is what makes that a
 * lookup rather than a choice.
 */
internal fun poolFor(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    now: Instant,
): Uuid = partyIdFor(characterId, bossCatalogId) ?: createSoloParty(userId, characterId, bossCatalogId, now)

/**
 * Records which mode this character runs a boss at alone, opening the pool if it has none yet.
 *
 * The one thing a clear cannot say for itself. Coupons are per (boss, difficulty) and no boss drops
 * them at every mode it has, so "Kalos cleared" on its own is 180 coupons or none. This is where a
 * boss run alone says which, the way a party says it on its config.
 *
 * The pool is opened by naming a mode, before anything has fallen in it. It is the same row logging
 * a drop would have opened, and it holds nothing until a clear or a human puts something there.
 *
 * Re-files the period this instant falls in, both ways round: it takes back only the rows it filed
 * itself and puts back what the mode it has NOW guarantees. So a mode named after the clear was
 * ticked does not leave this week's coupons missing until the reset, and Chaos corrected to Extreme
 * leaves one row of 180 rather than two.
 *
 * A party that is on keeps its roster and is not made solo, but its mode is written all the same: the
 * character's config and the party share one difficulty, and the last to set it wins.
 *
 * A RETIRED config and a SPENT ONE-OFF are not a party that is on, so each is taken back as the pool
 * it now is. See soloAgain.
 */
internal fun setSoloDifficulty(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    difficulty: String?,
    now: Instant,
): Uuid {
    val held = partyIdFor(characterId, bossCatalogId)
    // The pair's slot can be held by a config that is not a party anybody set up, and then there is
    // no other door out: a party needs somebody else in it. The same three takesOverConfig fills in
    // rather than refuses. A solo pool is already this. A retired config and a spent one-off both
    // claim nothing about now, so they are taken back as the pool this makes them.
    val takeBack = held != null && !isSoloParty(held) && (isRetiredParty(held) || isSpentOneOff(held, now))
    val liveParty = held != null && !isSoloParty(held) && !takeBack
    val partyId = held ?: createSoloParty(userId, characterId, bossCatalogId, now)
    if (takeBack) soloAgain(userId, partyId, characterId, reset, now)
    Party.update({ Party.id eq partyId }) {
        it[Party.difficulty] = difficulty
        it[updatedAt] = now
    }
    // Coupons a clear files are a solo pool's only; a party's are typed. See LootFromClear.kt.
    if (!liveParty) {
        val today = todayIn(now)
        unlootFromClear(characterId, bossCatalogId, reset, today)
        if (bossClearedOn(characterId, bossCatalogId, reset, today)) {
            lootFromClear(characterId, bossCatalogId, reset, today, now)
        }
    }
    // Re-files this period's pieces at the new mode, solo or party.
    syncPiecesForClear(characterId, bossCatalogId, periodStartFor(reset, now), now)
    return partyId
}

/**
 * Takes a config back as the pool for a boss this character now runs alone.
 *
 * The reverse of adoptSoloParty, and the only way back. One config per pair, so a retired party held
 * the slot for a boss now run alone with no door out: a party needs somebody else in it, and naming
 * a mode was refused over a config that is on no list to remove.
 *
 * writeMembers pins the roster onto every week already written before the other seats stop standing,
 * so the nights this was a party keep the split they were played under.
 *
 * The period being answered is not one of those nights. A clear ticked before anybody named the mode
 * makes the period count as written, and freezing the old duo onto it left the coupons the same call
 * then files owed half to somebody this claim had just taken off the roster. A week that already
 * holds a DROP is a night played and keeps its seats; the rest of the live period goes back to the
 * standing roster of one.
 */
internal fun soloAgain(
    userId: String,
    partyId: Uuid,
    characterId: Uuid,
    reset: String,
    now: Instant,
) {
    // Read before the write, so only the pins writeMembers is about to invent are taken back.
    val theirs = weeksSpelledOutFor(partyId) + weeksDroppedIn(partyId)
    writeMembers(partyId, characterId, emptyList(), SeatContext(userId, emptyMap(), now))
    val invented = weeksSpelledOutFor(partyId).filter { it >= liveFrom(reset, now) && it !in theirs }
    if (invented.isNotEmpty()) {
        PartyWeekSeat.deleteWhere {
            (PartyWeekSeat.partyId eq partyId) and (PartyWeekSeat.weekStart inList invented)
        }
    }
    Party.update({ Party.id eq partyId }) {
        it[solo] = true
        it[standing] = true
        // A night is not what this is: a pool is on every period, like the one createSoloParty opens.
        it[oneOff] = false
        it[updatedAt] = now
    }
}

/**
 * Turns a solo pool into the party it now is, without back-dating the new seats onto its drops.
 *
 * Every week that already holds a drop is spelled out first, naming the seat that was there alone.
 * Without it, selling one of those drops later would read the roster as it stands NOW, and owe a
 * share to somebody who was not in the game that night.
 */
internal fun adoptSoloParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    pinWeeksAlreadyDropped(partyId)
    Party.update({ Party.id eq partyId }) { it[solo] = false }
    saveParty(userId, partyId, request, now, sprites)
}

/**
 * Opens a solo pool up to a week that was not solo, WITHOUT giving it a standing roster.
 *
 * The other half of adoptSoloParty, for somebody who keeps no set parties. There, naming the party
 * IS the arrangement and the names become standing seats. Here the names are one Thursday's, and
 * writing them as standing would make every later week nobody answers for claim those same people
 * ran: rostersFor falls back to the standing seats, so next week's 180 coupons would divide three
 * ways and owe a share to somebody who was not in the game. That is a debt invented out of a
 * default, which is the wrong number this repo exists to prevent.
 *
 * So the config becomes a party whose only standing seat is your own character, and each week names
 * its own guests. A week nobody has answered for is then a roster of one, which divides nothing and
 * asks nothing, which is exactly what is known about it.
 *
 * One-off rather than standing for the same reason, and armed only for the period being answered: a
 * night with whoever was around is not a boss this character now runs every week.
 */
internal fun openSoloParty(
    partyId: Uuid,
    week: LocalDate,
    now: Instant,
) {
    // Before anything else, as adoptSoloParty does: every week that already holds a drop is spelled
    // out as the seat that was there alone, so the guests named now cannot reach back over a night
    // they were not in. The week being answered is overwritten by saveWeekRoster straight after.
    pinWeeksAlreadyDropped(partyId)
    Party.update({ Party.id eq partyId }) {
        it[solo] = false
        it[oneOff] = true
        it[updatedAt] = now
    }
    setRunsInPeriod(
        partyId,
        oneOff = true,
        periodShown(bossResetOf(bossIdOfParty(partyId)!!)!!, week, now),
        runs = true,
        now = now,
    )
}

/**
 * Spells out every week this pool already has a drop in, as the roster that week already reads.
 *
 * Called before any roster rewrite that could reach back over a night already played: adopting a
 * solo pool, and reviving a retired config. See takeOverParty.
 *
 * Through rosterFor, which is the same rule freezeWeeksAlreadyWritten pins by and for the reason
 * stated there: a seat that has left was not on a night after it left, and writing it in invents a
 * partner. Every seat ROW was read here instead, so the pin changed the very weeks it exists to hold
 * still. One solo night came out of it a duo, halving the share and asking for coupons for good.
 */
internal fun pinWeeksAlreadyDropped(partyId: Uuid) {
    val spelledOut = weeksSpelledOutFor(partyId)
    weeksDroppedIn(partyId)
        .distinct()
        .filterNot { it in spelledOut }
        .forEach { week ->
            rosterFor(partyId, week).forEach { seatId ->
                PartyWeekSeat.insert {
                    it[PartyWeekSeat.partyId] = partyId
                    it[weekStart] = week
                    it[memberId] = seatId
                }
            }
        }
}
