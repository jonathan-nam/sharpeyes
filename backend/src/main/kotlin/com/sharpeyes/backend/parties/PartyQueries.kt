package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.sprites.spriteProxyPath
import com.sharpeyes.backend.users.inActiveWorld
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.alias
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The reads behind /api/parties. `internal` rather than private, as the boss and token queries
// are, so the tests exercise these exact queries instead of a re-typed copy: the ownership filter
// is the thing most likely to be quietly wrong. Writes are in PartyWrites.kt.
// All of these must be called from inside a `transaction { }` block.

/** Six seats, the game's own party limit, so five OTHERS at most beside your own character. */
internal const val MAX_PARTY_SIZE = 6

/** Ten hours, longer than any night. A typo guard, not a claim about how long a boss takes. */
internal const val MAX_RUN_MINUTES = 600

/**
 * The most shares one seat can take of a split. A typo guard on a party of six, and the bound
 * V34__loot_quantity_and_shares.sql checks, so refusing here is the reason instead of a 500.
 */
internal const val MAX_SHARES = 99

/**
 * Every config, with its pool counted and its roster read for one week.
 *
 * [week] is the week being shown, or null for the live view, which is this week. Which CONFIGS
 * there are does not move with it (the party table has no period), and neither does `cleared`,
 * which answers for the period the config is in now: Party View reads the clears endpoint rather
 * than this field on a past week.
 *
 * The roster does move with it. A week somebody guested in ran a different party from the usual
 * one, and drawing today's roster over it would name people who were not there.
 *
 * Solo configs are left out unless [includeSolo]. They are pools, not parties, and every caller
 * that draws a roster, plans a night around one or attributes a seat to a person would be showing
 * a party of one. The Drop Log asks for them, because a drop is exactly what they hold.
 *
 * Retired configs are left out unless [includeRetired]. They are bosses this character no longer
 * runs, so no list that answers "what is on this week" should carry them. Every caller that reads
 * POOLS asks for them, and must: it keys its loot rows off the configs it was handed, so leaving one
 * out turns an outstanding split into a debt nobody owes. Party View draws only the standing ones
 * and still asks for all of them, because a coupon debt cancels against the other nights with the
 * same person and it billed one again that the Drop Log had already washed. See
 * V33__party_standing.sql.
 */
internal fun partiesFor(
    userId: String,
    week: LocalDate? = null,
    includeSolo: Boolean = false,
    includeRetired: Boolean = false,
): List<PartyResponse> {
    val wanted =
        (if (includeSolo) Op.TRUE else (Party.solo eq false)) and
            (if (includeRetired) Op.TRUE else (Party.standing eq true))
    val rows =
        Party
            .innerJoin(BossCatalog)
            // The config's own character, for its world. Named columns rather than the FK-inferred
            // overload: party_member also references characters, so "which link" is worth stating.
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where {
                // Narrowed to the world being shown. A party belongs to the world its character is
                // in, so this is the same lens the character list is under, applied one join along.
                (Party.userId eq userId) and inActiveWorld(userId) and wanted
            }.orderBy(BossCatalog.sortOrder)
            .toList()
    return partiesFromRows(rows, userId, week)
}

/**
 * The response for each of [rows], read as [userId].
 *
 * One batch of queries for the lot, which is the whole reason this is not a loop over findParty:
 * a list of seventeen parties would be a hundred round trips.
 *
 * [asCharacter] names, per party, the reader's OWN character in a party they do not own. A party in
 * that map is somebody else's book, so it comes back with `yours` false and its clear read against
 * the reader's character rather than the owner's. See seatedCharacterIn.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun partiesFromRows(
    rows: List<ResultRow>,
    userId: String,
    week: LocalDate? = null,
    asCharacter: Map<Uuid, Uuid> = emptyMap(),
): List<PartyResponse> {
    if (rows.isEmpty()) return emptyList()

    val shown = week ?: currentWeek()
    val partyIds = rows.map { it[Party.id] }
    val seatsByParty = seatsFor(partyIds, userId)
    val rosters = rostersFor(partyIds, shown)
    val counts = lootCountsFor(partyIds, shown)
    val clears = clearStateFor(rows, asCharacter)
    val spelledOut = weeksSpelledOut(partyIds, shown)
    // Against the week being SHOWN, not against now, so stepping back says what was said about that
    // week rather than what is true today. The trap `cleared` falls into: see clearStateFor.
    val off = notRunningIn(rows, week, Clock.System.now())
    val characterSlugs = characterSlugsFor(userId)

    return rows.map { row ->
        val id = row[Party.id]
        val seats = seatsByParty[id].orEmpty()
        val party =
            row.toPartyResponse(
                slug = partySlug(id, characterSlugs[row[Party.characterId]], row[BossCatalog.bossKey]),
                members = ranIn(seats, rosters[id].orEmpty()),
                seats = seats,
                loot = counts[id] ?: LootCounts(0, 0, 0),
                clear = clears[id] ?: ClearState(null, false),
                week = WeekState(usualRoster = id !in spelledOut, skippedThisPeriod = id in off),
            )
        if (id in asCharacter) party.copy(yours = false) else party
    }
}

internal fun findParty(
    partyId: Uuid,
    userId: String,
): PartyResponse? {
    val seen =
        Party
            .innerJoin(BossCatalog)
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
            // A party somebody else keeps the book for is readable by the people in it, and by
            // nobody else. See viewerOf.
            ?.let { found -> viewerOf(found, userId)?.let { found to it } } ?: return null
    val (row, viewer) = seen
    // This week's roster, because this is the page a drop is added and sold on, and those land in
    // the week it is now. The pool below it is all time, so an old drop stays settleable, and it
    // reads its payouts against `seats` rather than this.
    val week = currentWeek()
    val seats = seatsFor(listOf(partyId), userId)[partyId].orEmpty()
    val asCharacter = viewer.asCharacter?.let { mapOf(partyId to it) }.orEmpty()
    val clears = clearStateFor(listOf(row), asCharacter)
    val state =
        WeekState(
            usualRoster = partyId !in weeksSpelledOut(listOf(partyId), week),
            // The live view, which is the only one this reads: the period the boss is in now, which
            // for a monthly boss is not the month `week` started in. See periodShown.
            skippedThisPeriod = partyId in notRunningIn(listOf(row), week = null, now = Clock.System.now()),
        )
    val party =
        row.toPartyResponse(
            slug = partySlug(partyId, characterSlugsFor(userId)[row[Party.characterId]], row[BossCatalog.bossKey]),
            members = ranIn(seats, rosterFor(partyId, week)),
            seats = seats,
            // All time, unlike the list's. This is the page that sells a drop and pays it out, so a
            // week that hid an old one would put it beyond the only controls that can settle it.
            loot = lootCountsFor(listOf(partyId), week = null)[partyId] ?: LootCounts(0, 0, 0),
            clear = clears[partyId] ?: ClearState(null, false),
            week = state,
        )
    return party.copy(yours = viewer.owner)
}

/** True when the config exists and belongs to this user. The ownership check every write starts with. */
internal fun ownsParty(
    partyId: Uuid,
    userId: String,
): Boolean =
    Party
        .selectAll()
        .where { (Party.id eq partyId) and (Party.userId eq userId) }
        .empty()
        .not()

internal fun peopleFor(userId: String): List<PersonResponse> {
    val people =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .orderBy(Person.createdAt)
            .toList()
    if (people.isEmpty()) return emptyList()

    val characters = personCharacters(userId)

    return people.map {
        PersonResponse(
            id = it[Person.id].toString(),
            name = it[Person.name],
            characters = characters.attributed[it[Person.id]].orEmpty(),
            ownedCharacters = characters.owned[it[Person.id]].orEmpty(),
            linked = it[Person.linkedUserId] != null,
            pinned = it[Person.pinned],
        )
    }
}

/**
 * EVERY seat these configs have, in seat order, with whose character each one is.
 *
 * All of them, guests and retired members included, because this is what a payout is read against:
 * a share owed to somebody who has since left the party is still owed, and resolving it through
 * this week's roster would turn the drop unreadable the moment the week rolled over. Who ran a
 * given week is a narrowing of this, not a different query. See ranIn.
 *
 * The person is matched on the seat's character NAME, account-wide and stated once, so a seat
 * naming CreedBratton shows Chris in every config without storing him on each of them. Which
 * names belong to whom is personCharacters' answer, not this function's: a seat and the People
 * page reading that differently is how one screen ends up owing a share to somebody the other
 * does not.
 */
internal fun seatsFor(
    partyIds: List<Uuid>,
    userId: String,
): Map<Uuid, List<PartyMemberResponse>> {
    if (partyIds.isEmpty()) return emptyMap()
    // Every sprite this account has found, by character name. A sprite belongs to the CHARACTER,
    // not to the seat: the same person in three configs is the same character, and looking them up
    // once means the other two seats have a null of their own. Reading through this map is what
    // makes a character look the same in every party they are in.
    val spritesByName =
        seatSpritesByCharacter(userId)
            .mapNotNull { (name, seat) ->
                seat.spriteImgUrl?.let { name.lowercase() to it }
            }.toMap()

    val personNames =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .associate { it[Person.id] to it[Person.name] }
    val owners = personCharacters(userId).byCharacter()

    // Two joins to characters, so the alias says which is which: the seat's own character, and the
    // character on somebody else's account that the seat IS (V75). A seat can carry one or the
    // other and never both, which the migration states as a CHECK.
    val theirCharacter = Characters.alias("their_character")
    return PartyMember
        .join(Characters, JoinType.LEFT, PartyMember.characterId, Characters.id)
        .join(theirCharacter, JoinType.LEFT, PartyMember.linkedCharacterId, theirCharacter[Characters.id])
        .selectAll()
        .where { PartyMember.partyId inList partyIds }
        .orderBy(PartyMember.position)
        .groupBy({ it[PartyMember.partyId] }) { row ->
            val owner = owners[row[PartyMember.name].lowercase()]
            PartyMemberResponse(
                id = row[PartyMember.id].toString(),
                name = row[PartyMember.name],
                personId = owner?.toString(),
                personName = owner?.let { personNames[it] },
                characterId = row[PartyMember.characterId]?.toString(),
                linkedCharacterId = row[PartyMember.linkedCharacterId]?.toString(),
                spriteImgUrl = spriteFor(row, spritesByName, row.getOrNull(theirCharacter[Characters.spriteImgUrl])),
                guest = !row[PartyMember.standing],
                shares = row[PartyMember.shares],
            )
        }
}

/**
 * The seats out of [seats] that ran in a week, in seat order.
 *
 * A narrowing rather than a second query, so "who ran that week" can never name somebody the pool
 * cannot read a payout against.
 */
private fun ranIn(
    seats: List<PartyMemberResponse>,
    roster: List<Uuid>,
): List<PartyMemberResponse> {
    val ran = roster.map { it.toString() }.toSet()
    return seats.filter { it.id in ran }
}

/**
 * Whether this config's boss is cleared in the period it is currently in, and how that was known.
 *
 * Read from boss_clear, the same table the clear matrix reads and a planner capture writes. That
 * is the whole of the sync between the two pages: there is one answer to "is Kalos done this week
 * on mechyfechy", and both views are looking at it rather than keeping their own.
 *
 * `cleared` is null when no row exists, which is not the same as false: false means a capture or a
 * tick SAID it is not done, null means nobody has said anything this period.
 */
internal data class ClearState(
    val cleared: Boolean?,
    // No source screenshot, so it was ticked by hand rather than read off a planner. Worth showing:
    // a number you can trace to a capture and one somebody typed are not equally trustworthy.
    val byHand: Boolean,
)

/**
 * What the week being shown says about a config, as against what the config itself says.
 *
 * Both answer for that week and neither is a property of the party, which is why they are read per
 * request rather than stored: see weeksSpelledOut and notRunningIn.
 */
internal data class WeekState(
    // False when this week was spelled out with its own roster.
    val usualRoster: Boolean,
    // Not running its boss in the period being shown, whichever way it got there.
    val skippedThisPeriod: Boolean,
)

/**
 * Whether each config's boss is cleared, and how that was known.
 *
 * [asCharacter] replaces a config's own character, per party, for a member reading somebody else's:
 * the owner's tick says whether THEY have run it. See seatedCharacterIn.
 */
private fun clearStateFor(
    rows: List<ResultRow>,
    asCharacter: Map<Uuid, Uuid> = emptyMap(),
): Map<Uuid, ClearState> {
    if (rows.isEmpty()) return emptyMap()
    val now = Clock.System.now()

    // Per boss, because cadences differ: a weekly and a monthly boss are in different periods at
    // the same instant, and filtering on one date would answer for the other only on the day they
    // happen to coincide.
    val wanted =
        rows.associate { row ->
            row[Party.id] to
                Triple(
                    asCharacter[row[Party.id]] ?: row[Party.characterId],
                    row[Party.bossCatalogId],
                    periodStartFor(row[BossCatalog.reset], now),
                )
        }

    val found =
        BossClear
            .selectAll()
            .where { BossClear.characterId inList wanted.values.map { it.first }.distinct() }
            .associateBy {
                Triple(
                    it[BossClear.characterId],
                    it[BossClear.bossCatalogId],
                    it[BossClear.periodStart],
                )
            }

    return wanted.mapValues { (_, key) ->
        val row = found[key]
        ClearState(row?.get(BossClear.cleared), row != null && row[BossClear.sourceScreenshotId] == null)
    }
}

/**
 * The sprite to draw for a seat, from the freshest place that has one: your own character's row,
 * then a linked person's, then this seat's copy, then whatever this account has found for that
 * character NAME anywhere else.
 *
 * A character's OWN account keeps its sprite refreshed, so a seat that IS a real character reads it
 * off that row rather than a copy. insertSeat states the reason and it does not stop at your own
 * characters: "a copy would go stale the moment the character's own sprite is refreshed".
 *
 * The last fallback matters too. A character named in three configs is looked up once, so the other
 * two seats hold a null of their own, and reading only the seat left the same person drawn in one
 * row and blank in the next two.
 */
private fun spriteFor(
    row: ResultRow,
    spritesByName: Map<String, String>,
    theirSprite: String?,
): String? {
    val nexonUrl =
        row.getOrNull(Characters.spriteImgUrl)
            ?: theirSprite
            ?: row[PartyMember.spriteImgUrl]
            ?: spritesByName[row[PartyMember.name].lowercase()]
    // What goes out is our own proxy path, never Nexon's URL. See spriteProxyPath.
    return nexonUrl?.let { spriteProxyPath(it) }
}

private fun ResultRow.toPartyResponse(
    slug: String,
    members: List<PartyMemberResponse>,
    seats: List<PartyMemberResponse>,
    loot: LootCounts,
    clear: ClearState,
    week: WeekState,
) = PartyResponse(
    id = this[Party.id].toString(),
    slug = slug,
    characterId = this[Party.characterId].toString(),
    worldType = this[Characters.worldType],
    bossKey = this[BossCatalog.bossKey],
    difficulty = this[Party.difficulty],
    minutes = this[Party.minutes],
    solo = this[Party.solo],
    oneOff = this[Party.oneOff],
    retired = !this[Party.standing],
    looterMemberId = this[Party.looterMemberId]?.toString(),
    members = members,
    seats = seats,
    usualRoster = week.usualRoster,
    skippedThisPeriod = week.skippedThisPeriod,
    pendingLoot = loot.pending,
    awaitingPayout = loot.awaitingPayout,
    settledLoot = loot.settled,
    cleared = clear.cleared,
    clearedByHand = clear.byHand,
    createdAt = this[Party.createdAt].toString(),
    updatedAt = this[Party.updatedAt].toString(),
)
