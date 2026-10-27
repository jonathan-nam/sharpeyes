package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.MONTHLY_CADENCE
import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What each seat's share was, in a given week, and what freezes it there.
//
// `party_member.shares` is a STANDING arrangement and one value, and every unsold drop's
// entitlement is derived from it on READ (see foldSeats and entitlements). So agreeing a new split
// today re-divides every outstanding drop by it, including weeks somebody has already been shown a
// figure for. Nobody is told; the number simply changes. The roster does the same one step along: a
// week with no rows of its own reads as whoever is in the party TODAY.
//
// A week may therefore name its own shares, exactly as it can already name its own roster, and on
// the same row: party_week_seat already says "this member, in this week". See V55. One insert
// carries both facts, which is why the pin lives here beside the read. They are not pinned on the
// same terms: see pinWeeksAlreadyWritten.
//
// Beside PartyRoster.kt rather than in it, because that file answers who RAN and this answers on
// what terms. Inside a transaction, like the rest.

/**
 * The share each seat was on in [week], for the parties that named one.
 *
 * Only the weeks that spelled a share out. A seat missing here is on its standing
 * `party_member.shares`, which is every week nobody has changed the deal behind.
 */
internal fun weekSharesFor(
    partyIds: List<Uuid>,
    week: LocalDate,
): Map<Uuid, Map<Uuid, Int>> {
    if (partyIds.isEmpty()) return emptyMap()
    return PartyWeekSeat
        .selectAll()
        .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart eq week) }
        .mapNotNull { row ->
            val shares = row[PartyWeekSeat.shares] ?: return@mapNotNull null
            Triple(row[PartyWeekSeat.partyId], row[PartyWeekSeat.memberId], shares)
        }.groupBy({ it.first }) { it.second to it.third }
        .mapValues { (_, pairs) -> pairs.toMap() }
}

/**
 * Freezes the roster as it stands onto every week already written into, and the shares onto every
 * one of those that is settled.
 *
 * A config is a TEMPLATE, and that is what makes an ordinary edit reach back over nights already
 * played: swap a member in August and July's outstanding coupons re-divide, and a week somebody
 * guested in is drawn with today's party. So the weeks that have been written into keep the roster
 * they read now, and a swap applies from the first week nobody has written into.
 *
 * The two part company on the period the app is CURRENTLY in. Who ran is settled by turning up;
 * what they agreed is not. Freezing the live period made the usual order of things impossible:
 * ticking Hard Limbo cleared files its 60 guaranteed coupons on its own, which pinned the default
 * split before anybody had been asked, and no per-week share exists to correct it with (the week's
 * roster has one, see PartyRoster). So the live period takes the new deal, as V55 said it would.
 *
 * Except where the money has already moved. A sale writes party_loot_payout.shares from the split in
 * force and never re-derives it, so a week holding a sold drop is frozen whether or not it is over,
 * or one night ends up showing the receipt's split and the config's at the same time.
 *
 * Run BEFORE the standing roster is written, or there is nothing left to pin.
 *
 * Nothing is pinned when [wanted] is what the party already says. The config's other fields (its
 * difficulty, its run time, who loots) do not move a week, and spelling one out for them would
 * claim it ran something other than the usual party.
 *
 * A past week that already named its own roster or its own shares keeps them: it has an answer, and
 * this is not it. A week nobody spelled out is spelled out now, at the roster it actually ran, which
 * is the same move pinWeeksAlreadyDropped makes and for the same reason.
 *
 * A LIVE week is the other way round: it is put back to the standing deal, share and all. The rule
 * has to say what every week reads and not only what it writes, or a week pinned before the rule
 * changed keeps the pin and no edit can ever reach it.
 */
internal fun pinWeeksAlreadyWritten(
    partyId: Uuid,
    // The roster about to be written: each seat by lowercased name, and what it takes.
    wanted: Map<String, Int>,
    now: Instant,
) {
    if (wanted == standingSeats(partyId)) return
    // Read once and passed down. weeksClearedIn wants the same three columns, and liveFrom the same
    // cadence, so looking them up per helper is three round trips for one row.
    val config = Party.selectAll().where { Party.id eq partyId }.firstOrNull()
    val reset = config?.let { bossResetOf(it[Party.bossCatalogId]) }
    val weeks = config?.let { weeksAlreadyWritten(it, reset, now) }.orEmpty()
    if (weeks.isEmpty()) return
    val live = liveFrom(reset, now)

    val standing =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .associate { it[PartyMember.id] to it[PartyMember.shares] }

    // What each of those weeks already says, so a week that named its own share keeps it and one
    // that did not is filled in. Decided here rather than in a WHERE clause: three states (no row,
    // a row with no share, a row with one) read plainly in Kotlin and obscurely in SQL.
    val existing =
        PartyWeekSeat
            .selectAll()
            .where { (PartyWeekSeat.partyId eq partyId) and (PartyWeekSeat.weekStart inList weeks) }
            .associate {
                (it[PartyWeekSeat.weekStart] to it[PartyWeekSeat.memberId]) to it[PartyWeekSeat.shares]
            }

    weeks.forEach { week ->
        // A week this edit is not the deal for. Its roster is pinned either way; only these keep the
        // old split too.
        val settled = week < live || payoutsPinnedIn(partyId, week)
        // The roster as that week actually ran, not every seat the party has ever had: a guest from
        // another week was not in this one, and writing them in would invent a share for a night
        // they were not on.
        rosterFor(partyId, week).forEach { seatId ->
            val key = week to seatId
            // What this week's share should read after the edit: the old deal where the week is
            // settled, and the standing one, spelled NULL, where it is still being played.
            val pin = if (settled) standing[seatId] else null
            // A settled week names its own share and a live week does not, so this says the row is
            // already the shape it should be. Its share is then that week's own and not this
            // edit's, whichever of the two it is.
            val asItShouldBe = (existing[key] != null) == settled
            when {
                key !in existing ->
                    PartyWeekSeat.insert {
                        it[PartyWeekSeat.partyId] = partyId
                        it[weekStart] = week
                        it[memberId] = seatId
                        it[shares] = pin
                    }
                asItShouldBe -> Unit
                // Either a settled week that had no share, or a LIVE one that does. The second is
                // an earlier edit's pin, from before a live week was allowed to move, and clearing
                // it is the point: stopping the wrong pin from being made left every week that
                // already carried one stuck on it for good.
                else ->
                    PartyWeekSeat.update({
                        (PartyWeekSeat.partyId eq partyId) and
                            (PartyWeekSeat.weekStart eq week) and
                            (PartyWeekSeat.memberId eq seatId)
                    }) {
                        it[shares] = pin
                    }
            }
        }
    }
}

/**
 * The date a week has to start on or after to still be this edit's to write.
 *
 * A monthly period is LONGER than a week and opens mid-week, so it is measured from the month: every
 * week of the month being run is still being agreed. The week the month opened in is not one of
 * them. It holds the last days of the month that just closed, and those coupons are outstanding on a
 * deal people have been shown, so the straddling week counts as settled. It is a week-keyed table
 * and can hold one answer, so the closed month gets it. A monthly boss run in the first days of a
 * month is therefore still pinned at the split it was on, which is what master did with every week.
 *
 * Everything else fits inside a week, so the week is the unit and this week is live.
 *
 * This week when the boss cannot be found, which is the answer for two of the three cadences and
 * pins the straddling week of the third.
 */
internal fun liveFrom(
    reset: String?,
    now: Instant,
): LocalDate = if (reset == MONTHLY_CADENCE) periodStartFor(reset, now) else weekOf(todayIn(now))

/** The party as it stands: every seat in the usual roster, by lowercased name, and what it takes. */
private fun standingSeats(partyId: Uuid): Map<String, Int> =
    PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
        .associate { it[PartyMember.name].lowercase() to it[PartyMember.shares] }

/**
 * Every week this config has already been written into, up to the one the app is in now.
 *
 * Written is something DROPPED in it, or the boss ticked cleared in it. Either says the party ran,
 * and the party that ran is the one the config held at the time. A week nobody has written into is
 * still the template's to fill, which is what lets an edit made before this week's run reach it.
 *
 * Never a week after this one. A MONTHLY boss's clear covers the weeks either side of today as well
 * as today's, and freezing those would hold an edit back until the month turned over.
 */
internal fun weeksAlreadyWritten(
    config: ResultRow,
    reset: String?,
    now: Instant,
): List<LocalDate> {
    val thisWeek = weekOf(todayIn(now))
    val partyId = config[Party.id]
    return (weeksDroppedIn(partyId) + weeksClearedIn(config, reset)).distinct().filter { it <= thisWeek }
}

/** The weeks this party dropped something in. */
internal fun weeksDroppedIn(partyId: Uuid): List<LocalDate> =
    PartyLoot
        .selectAll()
        .where { PartyLoot.partyId eq partyId }
        .map { weekOf(it[PartyLoot.droppedOn]) }

/**
 * The weeks this config's boss was ticked cleared in, per the boss's own cadence.
 *
 * A clear is filed against a PERIOD, and only a weekly boss's period is a week. A daily one lands
 * inside a week, and a monthly one spans four or five without saying which of them the kill was in,
 * so all of them count as written rather than the pin guessing one.
 */
private fun weeksClearedIn(
    config: ResultRow,
    reset: String?,
): List<LocalDate> {
    val bossId = config[Party.bossCatalogId]
    val characterId = config[Party.characterId]
    return reset
        ?.let { reset ->
            BossClear
                .selectAll()
                .where {
                    (BossClear.characterId eq characterId) and
                        (BossClear.bossCatalogId eq bossId) and
                        (BossClear.cleared eq true)
                }.flatMap { weeksIn(reset, it[BossClear.periodStart]) }
        }.orEmpty()
}

/** The weeks a period covers, stepped by BossPeriod's own reckoning rather than a second one. */
private fun weeksIn(
    reset: String,
    periodStart: LocalDate,
): List<LocalDate> {
    val ends = periodAfter(reset, periodStart)
    return generateSequence(weekOf(periodStart)) { periodAfter(WEEKLY_CADENCE, it) }
        .takeWhile { it < ends }
        .toList()
}
