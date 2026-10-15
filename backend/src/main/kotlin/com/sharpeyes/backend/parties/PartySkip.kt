package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyPeriodRun
import com.sharpeyes.backend.db.PartyPeriodSkip
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Whether a config runs in one period. Held apart from PartyRoster.kt because the two answer
// different questions and are kept by different clocks: a roster is who ran in a Thursday week,
// this is whether the boss was run at all in the period the boss is answered for.
//
// A config has a default and a set of exceptions to it, and which table holds the exceptions
// depends on which default it has:
//   standing (one_off = false)   on, except the periods party_period_skip names
//   one-off  (one_off = true)    off, except the periods party_period_run names
// Either way the absence of a row is the answer, so undoing is a deletion and the next period
// reverts to the default without being told to. See V31 and V32.
//
// Inside a transaction, like the rest.

/**
 * The period a view is asking about, for a boss on this cadence.
 *
 * The live view is the period the boss is in NOW, which for a monthly boss is not the month the
 * current Thursday started in: on the first days of a month those two disagree, and answering with
 * the week's month would draw last month's mark over this one.
 *
 * A past week is that week for a weekly boss, and the month around it for a monthly one. Party View
 * drops monthly configs from a history view anyway, so that second case is a coherent answer rather
 * than one anything currently reads.
 */
internal fun periodShown(
    reset: String,
    week: LocalDate?,
    now: Instant,
): LocalDate = if (week == null) periodStartFor(reset, now) else periodOf(reset, week)

private fun skipMarks(partyIds: List<Uuid>): Set<Pair<Uuid, LocalDate>> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyPeriodSkip
        .selectAll()
        .where { PartyPeriodSkip.partyId inList partyIds }
        .map { it[PartyPeriodSkip.partyId] to it[PartyPeriodSkip.periodStart] }
        .toSet()
}

private fun runMarks(partyIds: List<Uuid>): Set<Pair<Uuid, LocalDate>> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyPeriodRun
        .selectAll()
        .where { PartyPeriodRun.partyId inList partyIds }
        .map { it[PartyPeriodRun.partyId] to it[PartyPeriodRun.periodStart] }
        .toSet()
}

/**
 * Which of these configs are NOT running in the period [week] is asking about.
 *
 * One question with one answer, whichever default the config has: a standing party somebody took
 * off this week and a one-off whose week has passed are both "not on this period", and everything
 * downstream (the list, the counts, Run Order) wants exactly that one fact.
 *
 * Per boss, because cadences differ, the same reason clearStateFor keys by period rather than
 * filtering on one date: a weekly and a monthly boss are in different periods at the same instant.
 *
 * [rows] are joined Party ⨝ BossCatalog rows, as partiesFor already has them.
 */
internal fun notRunningIn(
    rows: List<ResultRow>,
    week: LocalDate?,
    now: Instant,
): Set<Uuid> {
    if (rows.isEmpty()) return emptySet()
    val skipped = skipMarks(rows.filterNot { it[Party.oneOff] }.map { it[Party.id] })
    val ran = runMarks(rows.filter { it[Party.oneOff] }.map { it[Party.id] })

    return rows
        .filter { row ->
            val key = row[Party.id] to periodShown(row[BossCatalog.reset], week, now)
            if (row[Party.oneOff]) key !in ran else key in skipped
        }.map { it[Party.id] }
        .toSet()
}

/** Whether this one config runs in [period]. [oneOff] decides which table is the exception list. */
internal fun runsInPeriod(
    partyId: Uuid,
    oneOff: Boolean,
    period: LocalDate,
): Boolean {
    val key = partyId to period
    return if (oneOff) key in runMarks(listOf(partyId)) else key !in skipMarks(listOf(partyId))
}

/** True when this config is on for one period at a time rather than standing. */
internal fun isOneOff(partyId: Uuid): Boolean =
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Party.oneOff) == true

/** True when this config is a one-off that is not on the period the app is in now. */
internal fun isSpentOneOff(
    partyId: Uuid,
    now: Instant,
): Boolean {
    val row =
        Party
            .innerJoin(BossCatalog)
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
    if (row == null || !row[Party.oneOff]) return false
    return !runsInPeriod(partyId, oneOff = true, periodShown(row[BossCatalog.reset], week = null, now = now))
}

/**
 * Whether the config already holding this pair's slot is filled in rather than refused.
 *
 * Three kinds are not a party anybody set up, so a second config must not be made for them: a solo
 * pool, a retired config, and a one-off whose period has passed.
 *
 * A one-off still ON its period is the fourth, and only when the request is standing. That is the
 * pair saying "we are doing this every week now", and the edit page offers the boss for exactly that
 * reason: a one-off is not one of its rows, so the only way it could otherwise answer is a refusal
 * naming a config the page does not show. Asked for as a one-off again it is still refused, where
 * the request would overwrite tonight's roster with itself.
 *
 * Must run inside a transaction. See takeOverParty for what filling it in does.
 */
internal fun takesOverConfig(
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
): Boolean =
    isSoloParty(partyId) ||
        isRetiredParty(partyId) ||
        isSpentOneOff(partyId, now) ||
        (!request.oneOff && isOneOff(partyId))

/**
 * Fills in the config already holding this pair's slot, whichever kind it is.
 *
 * A solo pool becomes a party, and adoptSoloParty pins the weeks its drops already fell in. A
 * one-off whose period has passed is saved over and armed for the period the app is in now, which
 * is what running the same boss again a month later means: the same config, on again.
 *
 * A solo pool asked for as a one-off becomes one, so a drop logged before the party was named does
 * not quietly turn a single night into a standing arrangement.
 *
 * A RETIRED config comes back standing, which is what adding a boss a character used to run means.
 * Its drops are already in the wallet and the Drop Log and stay exactly where they were: the weeks
 * they fell in are spelled out first, so the roster being written now is not back-dated over a
 * night it was not the roster for. Same hazard adoptSoloParty guards, same guard.
 */
internal fun takeOverParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    val period = periodShown(bossResetOf(bossIdOfParty(partyId)!!)!!, week = null, now = now)
    val solo = isSoloParty(partyId)
    if (solo) {
        adoptSoloParty(userId, partyId, request, now, sprites)
    } else {
        if (isRetiredParty(partyId)) {
            pinWeeksAlreadyDropped(partyId)
            Party.update({ Party.id eq partyId }) {
                it[standing] = true
                it[partySince] = now
            }
        }
        saveParty(userId, partyId, request, now, sprites)
    }

    // Not for a request that names nobody: saveParty has just made this the pool for a boss run
    // alone, and a pool is on every period rather than one night. See soloAgain.
    if (request.oneOff && request.members.isNotEmpty()) {
        Party.update({ Party.id eq partyId }) { it[oneOff] = true }
        setRunsInPeriod(partyId, oneOff = true, period, runs = true, now = now)
        // The names belong to the night, not to every week after it. See writeNightRoster.
        writeNightRoster(
            partyId,
            characterIdOfParty(partyId)!!,
            request.members,
            now,
            SeatContext(userId, sprites, now),
        )
    } else if (!solo) {
        // A one-off asked for as a standing party, which is what "we are doing this every week now"
        // looks like, whether or not its own week is still on. Its armed periods are left alone:
        // they are what a past week is drawn from, and a standing config does not read them.
        // Only from a one-off: re-saving a standing party is not it becoming one.
        val becomesStanding = isOneOff(partyId)
        Party.update({ Party.id eq partyId }) {
            if (becomesStanding) it[partySince] = now
            it[oneOff] = false
        }
    }
    syncPiecesForParty(partyId, now, period)
}

/**
 * Says whether this config runs in [period].
 *
 * Writes to whichever table holds this config's exceptions, and going back to the default is always
 * the deletion of a row: that is what makes the next period revert with nobody saying so.
 *
 * insertIgnore because saying it twice is saying it once: the PK already holds the invariant, and a
 * second click should not be an error the user has to read.
 */
internal fun setRunsInPeriod(
    partyId: Uuid,
    oneOff: Boolean,
    period: LocalDate,
    runs: Boolean,
    now: Instant,
) {
    // The exception applies when a one-off runs, or when a standing party does not. Anything else
    // is the config back at its default, and a default is the absence of a row.
    val exceptional = oneOff == runs
    when {
        oneOff && exceptional ->
            PartyPeriodRun.insertIgnore {
                it[PartyPeriodRun.partyId] = partyId
                it[periodStart] = period
                it[createdAt] = now
            }
        oneOff ->
            PartyPeriodRun.deleteWhere {
                (PartyPeriodRun.partyId eq partyId) and (PartyPeriodRun.periodStart eq period)
            }
        exceptional ->
            PartyPeriodSkip.insertIgnore {
                it[PartyPeriodSkip.partyId] = partyId
                it[periodStart] = period
                it[createdAt] = now
            }
        else ->
            PartyPeriodSkip.deleteWhere {
                (PartyPeriodSkip.partyId eq partyId) and (PartyPeriodSkip.periodStart eq period)
            }
    }
    // A party that stops running a week stops dividing that week's pile.
    syncPiecesForParty(partyId, now, period)
}
