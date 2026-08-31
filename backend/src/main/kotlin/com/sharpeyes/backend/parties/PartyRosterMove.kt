package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Moving somebody from one party to another on the same boss.
//
// A character is in one party per boss, which is the rule that makes a week's clear answerable: two
// configs running the same character on Limbo cannot both have killed it. So the roster rule refused
// the move, and the only way through was to empty the old party in a write of its own. That write
// was not offered anywhere, and on a duo it is not even expressible: taking the one other member out
// leaves a solo run, which validateMembers refuses.
//
// The rule stands. What changed is that it is now answerable: the save comes back saying which
// parties hold the people it wants, and sending it again with those ids in `releaseFrom` does both
// halves in one transaction.

/** A config's seats as one list: your character, then the people it runs the boss with. */
internal fun rosterOf(
    characterId: Uuid?,
    members: List<String>,
): List<String> = listOfNotNull(characterId?.let(::characterName)) + members

/** A character of yours by id, or null where the row is gone. See ownSeatName for the sure case. */
internal fun characterName(characterId: Uuid): String? =
    Characters
        .selectAll()
        .where { Characters.id eq characterId }
        .firstOrNull()
        ?.get(Characters.name)

/**
 * Why this roster cannot stand against the boss's other configs, or null.
 *
 * A character clears a boss once a period, so naming one in two configs for the same boss states
 * something the game cannot do: only one of the two can ever run. Run Order had to drop one of them
 * and could say nothing useful about which, so the pair is refused at the point it is written.
 *
 * `exclude` is the config being edited, which is not competition with itself.
 *
 * Owner and members are one list here. A character occupies its slot whichever end of a config it
 * sits at, and letting it own one config and sit in another for the same boss is the same clash
 * through a different door.
 *
 * Only seats that are still IN a roster compete. A seat somebody left is retired rather than
 * deleted, because a payout or a past week points at it (see retireOrDelete), and a retired seat is
 * not running the boss with anybody. Counting one refused a roster over somebody the party no
 * longer has, naming a config the user could look straight at and not find them in.
 *
 * Which of the others count depends on what is being written, because the two are only in each
 * other's way in a period they would both run. A STANDING config runs in every period from here on,
 * so anything that has not stopped for good competes with it: a one-off whose period has passed
 * holds nobody, and a config merely skipped this week still does. That is the difference between
 * not running once and not running again.
 *
 * [oneOff] is a single night, so only its own period is asked about, and a config skipped in that
 * period is not running the boss then. Same fact as validateWeekRoster's, read against the period
 * rather than the week: a party taken off for the week is one its members were free to run the boss
 * with somebody else. Without it, taking a party off this week and running its boss with a different
 * pair the same week was refused, and the only way through was retiring the standing config.
 *
 * Both ways of arming a spent one-off again come back through this rule (takeOverParty and
 * setSkipRoute), so the two can still never be on at the same time.
 *
 * Must run inside a transaction.
 */
internal fun validateBossRoster(
    userId: String,
    bossCatalogId: Uuid,
    exclude: Uuid?,
    roster: List<String>,
    now: Instant,
    oneOff: Boolean,
): String? =
    bossRosterClashes(userId, bossCatalogId, exclude, roster, now, oneOff)
        .firstOrNull()
        ?.let { "${it.memberName} is already in your ${it.ownerName} party for this boss" }

/**
 * A seat this roster would have to take from another party on the same boss.
 *
 * [collapses] is whether that party would be left with nobody but its own character, which is not a
 * party: taking the seat removes it. The screen offering the move has to be able to say so.
 */
internal data class RosterClash(
    val partyId: Uuid,
    val memberName: String,
    val ownerName: String,
    val collapses: Boolean,
)

/** What the roster rule is being asked about, and what a write of it would need. */
internal data class RosterTarget(
    val request: SavePartyRequest,
    val bossCatalogId: Uuid?,
    val characterId: Uuid?,
    /** The config being written, which cannot clash with itself. Null while creating one. */
    val exclude: Uuid?,
    val oneOff: Boolean,
    val context: SeatContext,
)

/**
 * Every seat on this boss that [roster] would take from another of your parties.
 *
 * The list rather than the first, because the answer offered is a move: a save adding two people
 * who are each spoken for has two parties to take them out of, and naming one would leave the
 * second refusing after the first had already been emptied.
 *
 * Must run inside a transaction.
 */
internal fun bossRosterClashes(
    userId: String,
    bossCatalogId: Uuid,
    exclude: Uuid?,
    roster: List<String>,
    now: Instant,
    oneOff: Boolean,
): List<RosterClash> {
    val wanted = roster.map { it.trim().lowercase() }.toSet()
    // The one period a one-off runs in, or null for a config that runs in all of them. A boss whose
    // reset cannot be read leaves it null, which asks the stricter question rather than guessing a
    // period and letting a real clash through.
    val period = if (oneOff) bossResetOf(bossCatalogId)?.let { periodStartFor(it, now) } else null

    if (wanted.isEmpty()) return emptyList()
    // Every seat this account already has on this boss. Compared in Kotlin rather than SQL: it is a
    // handful of rows per boss, and the case-folding then matches validateMembers' rather than
    // Postgres's collation.
    val clashes =
        PartyMember
            .innerJoin(Party)
            .selectAll()
            .where {
                (Party.userId eq userId) and
                    (Party.bossCatalogId eq bossCatalogId) and
                    // The config is live, AND the seat is still in its roster. Two different
                    // `standing` columns, and reading only the first was the bug.
                    (Party.standing eq true) and
                    (PartyMember.standing eq true)
            }.filter { exclude == null || it[Party.id] != exclude }
            .filter { it[PartyMember.name].trim().lowercase() in wanted }
            // Last, and on the matches only: it is a query per row, and there are usually none.
            // Every candidate is on the same boss, hence the same cadence, so the one period
            // answers for all of them.
            .filter {
                val other = it[Party.id]
                if (period == null) {
                    !isSpentOneOff(other, now)
                } else {
                    runsInPeriod(other, isOneOff(other), period)
                }
            }

    return clashes.map { row ->
        val other = row[Party.id]
        // Every name being taken from THIS party, not just this row's: a save that takes two of a
        // trio's three seats collapses it, and asking one seat at a time would say it survives.
        val taken = clashes.filter { it[Party.id] == other }.map { it[PartyMember.name] }
        RosterClash(
            partyId = other,
            memberName = row[PartyMember.name],
            ownerName = ownSeatName(row[Party.characterId]),
            collapses = standingMembersBesides(other, taken).isEmpty(),
        )
    }
}

/**
 * The standing seats of [partyId] that are neither its own character's nor in [taken].
 *
 * What decides whether taking those seats leaves a party behind. Empty means it does not: the
 * config would be one character running a boss alone, which validateMembers refuses to write and
 * releaseFromParty has to remove rather than leave sitting as a party of one.
 */
private fun standingMembersBesides(
    partyId: Uuid,
    taken: List<String>,
): List<String> {
    val ownName = characterIdOfParty(partyId)?.let(::ownSeatName)?.lowercase()
    val gone = taken.map { it.trim().lowercase() }.toSet()
    return PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
        .map { it[PartyMember.name].trim() }
        .filterNot { it.lowercase() == ownName || it.lowercase() in gone }
}

/**
 * The last rule a save has to keep, and the write behind it.
 *
 * Separate from the others because it is the only one the user can answer. Everything
 * validateSavedPartyRules refuses is a request that cannot be written at all; this one has a second
 * way through, so the routes ask for those first and never offer a move over a bad difficulty.
 *
 * Both halves happen here, in the caller's transaction. A move that released the seat and then
 * failed to write the roster would leave that character in no party at all, which is worse than the
 * refusal it replaced.
 *
 * Returns whatever [write] returns, a RosterConflictResponse for a clash nobody has agreed to, or a
 * message for a `releaseFrom` naming a party this save was never going to take from.
 */
internal fun applyRoster(
    target: RosterTarget,
    write: () -> Any,
): Any {
    val userId = target.context.userId
    if (target.bossCatalogId == null) return write()
    val roster = rosterOf(target.characterId, target.request.members)
    val clashes =
        bossRosterClashes(
            userId,
            target.bossCatalogId,
            target.exclude,
            roster,
            target.context.now,
            target.oneOff,
        )
    // Only the ids this save was actually going to take from. An id for another boss, another
    // account, or a party this roster has no quarrel with is refused rather than ignored: it would
    // empty a party the user was never shown.
    val agreed =
        target.request.releaseFrom
            .mapNotNull { Uuid.parseOrNull(it) }
            .toSet()
    val outstanding = clashes.filterNot { it.partyId in agreed }
    return when {
        (agreed - clashes.map { it.partyId }.toSet()).isNotEmpty() ->
            "releaseFrom names a party this save does not take anybody from"
        outstanding.isNotEmpty() -> conflictOf(outstanding)
        else -> {
            val leaving = roster.map { it.trim() }.toSet()
            agreed.forEach { releaseFromParty(it, userId, leaving, target.context) }
            write()
        }
    }
}

/**
 * A save over an existing config: its rules, then the roster, then the write.
 *
 * One composition, so the route and its tests cannot come to disagree about the order. The order is
 * the point: the rules refuse a request that cannot be written at all, and only then is the one
 * answerable rule asked, so a bad difficulty never comes back as an offer to move somebody.
 *
 * Null where the config is not yours, which the route answers as a 404.
 */
internal fun writeSavedParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
    oneOff: Boolean = isOneOff(partyId),
): Any? {
    if (!ownsParty(partyId, userId)) return null
    return validateSavedPartyRules(partyId, request)
        ?: applyRoster(
            RosterTarget(
                request,
                bossIdOfParty(partyId),
                characterIdOfParty(partyId),
                exclude = partyId,
                oneOff = oneOff,
                context = SeatContext(userId, sprites, now),
            ),
        ) {
            saveParty(userId, partyId, request, now, sprites)
            findParty(partyId, userId)!!
        }
}

/** The clash, worded for a screen that is going to offer the move rather than restate it. */
private fun conflictOf(outstanding: List<RosterClash>): RosterConflictResponse {
    val first = outstanding.first()
    val moves =
        outstanding.map {
            RosterMoveResponse(
                partyId = it.partyId.toString(),
                member = it.memberName,
                fromCharacter = it.ownerName,
                removesParty = it.collapses,
            )
        }
    return RosterConflictResponse(
        message = "${first.memberName} is already in your ${first.ownerName} party for this boss",
        moves = moves,
    )
}

/**
 * Takes [leaving] out of another party on the same boss, so this save can have them.
 *
 * Written through writeMembers rather than by deleting the seat, so the move keeps everything an
 * ordinary edit keeps: weeks already played are pinned to the roster that played them, a seat with
 * loot behind it is retired rather than removed, and what the remaining seats take is carried over
 * instead of resetting to a share each.
 *
 * A party left with nobody but its own character is not a party, so it goes the way Remove sends
 * it: retired if it holds drops, deleted if it holds none. Its pool and its history stay either way.
 */
internal fun releaseFromParty(
    partyId: Uuid,
    userId: String,
    leaving: Set<String>,
    context: SeatContext,
) {
    val ownCharacterId = characterIdOfParty(partyId) ?: return
    val ownName = ownSeatName(ownCharacterId)
    val gone = leaving.map { it.trim().lowercase() }.toSet()
    val standing =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
            .orderBy(PartyMember.position)
            .map { it[PartyMember.name].trim() to it[PartyMember.shares] }
    val kept =
        standing
            .map { it.first }
            .filterNot { it.equals(ownName, ignoreCase = true) || it.lowercase() in gone }
    if (kept.isEmpty()) {
        retireOrDeleteParty(partyId, userId, context.now)
        return
    }
    // Every standing seat's share, your own included: writeMembers reads a name it is not given as
    // one share, so passing only the members would flatten a party that had agreed otherwise.
    writeMembers(partyId, ownCharacterId, kept, context, standing.toMap())
}
