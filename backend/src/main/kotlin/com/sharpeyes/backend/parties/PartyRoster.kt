package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootPayout
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Who ran, in a given week.
//
// One question with one answer, and everything asks it here: the party list, the loot pool's
// payouts, and the seller a sale may name. A second implementation of "who was in this party" is
// how a payout roster and the roster on screen come to disagree, which is a wrong number wearing
// the right party's name.
//
// Inside a transaction, like the rest.

/** The week the app is in now, which is what a caller means by "this week". */
internal fun currentWeek(): LocalDate = periodStartFor(WEEKLY_CADENCE, Clock.System.now())

/**
 * The seats each party ran with in [week], in seat order.
 *
 * A week with rows in party_week_seat ran exactly those. A week with none ran the standing roster,
 * which is most weeks and is why the absence of rows is the answer rather than a missing one.
 */
internal fun rostersFor(
    partyIds: List<Uuid>,
    week: LocalDate,
): Map<Uuid, List<Uuid>> {
    if (partyIds.isEmpty()) return emptyMap()

    val seatOrder =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId inList partyIds }
            .orderBy(PartyMember.position)
            .map { Triple(it[PartyMember.partyId], it[PartyMember.id], it[PartyMember.standing]) }

    val overridden =
        PartyWeekSeat
            .selectAll()
            .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart eq week) }
            .groupBy({ it[PartyWeekSeat.partyId] }) { it[PartyWeekSeat.memberId] }
            .mapValues { (_, ids) -> ids.toSet() }

    return partyIds.associateWith { partyId ->
        val seats = seatOrder.filter { it.first == partyId }
        val thisWeek = overridden[partyId]
        // Ordered by the seat's own position either way, so a week's roster is not shuffled by the
        // order rows happened to come back in.
        seats.filter { if (thisWeek == null) it.third else it.second in thisWeek }.map { it.second }
    }
}

/** One party's roster for a week. */
internal fun rosterFor(
    partyId: Uuid,
    week: LocalDate,
): List<Uuid> = rostersFor(listOf(partyId), week)[partyId].orEmpty()

/**
 * Every roster and week share for a set of parties across a set of weeks, in two queries.
 *
 * [rostersFor] costs three queries per week (seats, this week's overrides, and the shares off the
 * same table), and a pool spans months: a Drop Log read asked for eight weeks, so twenty-four
 * queries, eight of them the identical seat read. This asks once for the seats and once for every
 * week's overrides, and does the same grouping in memory.
 *
 * Equivalence with the per-week functions is the whole requirement, since this decides who a drop
 * divides by. LootWeekBatchTest asserts it against [rostersFor] and [weekSharesFor] themselves
 * rather than against a copy of their logic.
 */
internal fun weekRostersFor(
    partyIds: List<Uuid>,
    weeks: Set<LocalDate>,
): WeekRosters {
    if (partyIds.isEmpty() || weeks.isEmpty()) return WeekRosters(emptyList(), emptyMap(), emptyMap())

    val seatOrder =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId inList partyIds }
            .orderBy(PartyMember.position)
            .map { Triple(it[PartyMember.partyId], it[PartyMember.id], it[PartyMember.standing]) }

    val weekRows =
        PartyWeekSeat
            .selectAll()
            .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart inList weeks.toList()) }
            .map {
                Triple(
                    it[PartyWeekSeat.partyId] to it[PartyWeekSeat.weekStart],
                    it[PartyWeekSeat.memberId],
                    it[PartyWeekSeat.shares],
                )
            }

    // A key exists for every (party, week) with ANY row, whatever its shares. That is the
    // distinction rostersFor turns on: no rows means the standing roster ran, and rows with null
    // shares still mean the week was spelled out. See V55 and #509.
    val overridden = weekRows.groupBy({ it.first }) { it.second }.mapValues { (_, ids) -> ids.toSet() }

    // Shares drop the null rows, and a party left with none gets no entry at all, which is what
    // weekSharesFor's mapNotNull does.
    val shares =
        weekRows
            .mapNotNull { (key, memberId, share) -> share?.let { Triple(key, memberId, it) } }
            .groupBy({ it.first }) { it.second to it.third }
            .mapValues { (_, pairs) -> pairs.toMap() }

    return WeekRosters(seatOrder, overridden, shares)
}

/** The answers [weekRostersFor] read, asked per party and week. */
internal class WeekRosters(
    private val seatOrder: List<Triple<Uuid, Uuid, Boolean>>,
    private val overridden: Map<Pair<Uuid, LocalDate>, Set<Uuid>>,
    private val shares: Map<Pair<Uuid, LocalDate>, Map<Uuid, Int>>,
) {
    /** Ordered by the seat's own position, as rostersFor is, so a week's roster is not shuffled. */
    fun roster(
        partyId: Uuid,
        week: LocalDate,
    ): List<Uuid> {
        val seats = seatOrder.filter { it.first == partyId }
        val thisWeek = overridden[partyId to week]
        return seats.filter { if (thisWeek == null) it.third else it.second in thisWeek }.map { it.second }
    }

    fun shares(
        partyId: Uuid,
        week: LocalDate,
    ): Map<Uuid, Int>? = shares[partyId to week]
}

/**
 * Which of these parties had [week] spelled out, rather than running the usual roster.
 *
 * What tells "the usual party, which happens to be these three" from "these three, this week". The
 * roster alone cannot: a week that only drops somebody names no guest, and would read as usual.
 */
internal fun weeksSpelledOut(
    partyIds: List<Uuid>,
    week: LocalDate,
): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyWeekSeat
        .selectAll()
        .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart eq week) }
        .map { it[PartyWeekSeat.partyId] }
        .toSet()
}

/**
 * Why this week cannot be told who ran, or null.
 *
 * Lives here rather than with the other validations because it is one claim with the fact it rests
 * on, which is the next function down.
 *
 * A week that has not happened is refused outright: there is nothing to record about it, and the
 * roster it would pin is the one the party would have reverted to on its own.
 */
internal fun validateRosterWeek(
    partyId: Uuid,
    week: LocalDate,
    thisWeek: LocalDate,
): String? =
    when {
        week > thisWeek -> "a week that has not happened yet cannot be answered for"
        week != thisWeek && payoutsPinnedIn(partyId, week) -> "that week has already been paid out"
        else -> null
    }

/**
 * Whether anything this party dropped in [week] has had its payouts pinned.
 *
 * What decides whether a past week's roster may still be said. A payout row was written from the
 * roster as it stood when the drop sold and is never re-derived, so rewriting who ran behind one
 * leaves the roster and the money owed disagreeing with nothing on screen saying which is right.
 * Until a drop sells there is nothing pinned to disagree with, and the week is still answerable.
 *
 * Filtered in Kotlin rather than in SQL because the reset week is BossPeriod.kt's to work out, and a
 * second implementation of it in a WHERE clause is a second answer to which week a Thursday drop is
 * in. A pool is a handful of rows.
 */
internal fun payoutsPinnedIn(
    partyId: Uuid,
    week: LocalDate,
): Boolean {
    val inWeek =
        PartyLoot
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            .filter { weekOf(it[PartyLoot.droppedOn]) == week }
            .map { it[PartyLoot.id] }
    if (inWeek.isEmpty()) return false
    return PartyLootPayout
        .selectAll()
        .where { PartyLootPayout.lootId inList inWeek }
        .empty()
        .not()
}

/** Every week of this one party that names its own roster, rather than running the usual one. */
internal fun weeksSpelledOutFor(partyId: Uuid): Set<LocalDate> =
    PartyWeekSeat
        .selectAll()
        .where { PartyWeekSeat.partyId eq partyId }
        .map { it[PartyWeekSeat.weekStart] }
        .toSet()

/** The seats any week of this party names, so one a week still needs is retired and not deleted. */
internal fun seatsInAnyWeekRoster(partyId: Uuid): Set<Uuid> =
    PartyWeekSeat
        .selectAll()
        .where { PartyWeekSeat.partyId eq partyId }
        .map { it[PartyWeekSeat.memberId] }
        .toSet()

/**
 * Says who ran this week, or puts the week back to the usual party.
 *
 * A null [members] deletes the week's rows, which is what makes going back to normal a deletion
 * rather than a second roster to keep in step, and what makes next week revert without being told.
 *
 * Otherwise the names ARE the week: a usual member not among them is out for it, and a character
 * the party has never sat gets a seat of their own with standing = false. That seat is what a
 * payout can point at, which is the whole reason a guest is a seat and not a name on a list.
 *
 * The party's own roster is untouched either way. That is the point of the feature.
 *
 * Written here rather than in PartyWrites.kt, beside the read: "no rows means the usual roster" is
 * one rule, and putting it in one file and its inverse in another is how the two come apart.
 */
internal fun saveWeekRoster(
    partyId: Uuid,
    ownCharacterId: Uuid,
    week: LocalDate,
    members: List<String>?,
    context: SeatContext,
) {
    // The week's own shares, carried across the rewrite. The rows are replaced rather than edited,
    // and shares ride on them (see V55), so without this saying who ran a week ALSO handed it back
    // to today's standing split, silently and for a week that was pinned precisely because somebody
    // had been shown a figure for it.
    val pinned =
        PartyWeekSeat
            .selectAll()
            .where { (PartyWeekSeat.partyId eq partyId) and (PartyWeekSeat.weekStart eq week) }
            .mapNotNull { row -> row[PartyWeekSeat.shares]?.let { row[PartyWeekSeat.memberId] to it } }
            .toMap()
    PartyWeekSeat.deleteWhere { (PartyWeekSeat.partyId eq partyId) and (PartyWeekSeat.weekStart eq week) }
    if (members == null) return

    val existing = seatIdsByName(partyId)
    // After every seat the party already has, so a guest does not take a usual member's place in
    // the order and shuffle the roster strip on the weeks they are not in.
    var nextPosition = existing.size
    val mine = ownCharacterIds(context.userId)

    seatNames(ownSeatName(ownCharacterId), members).forEach { name ->
        val seatId =
            existing[name.lowercase()]
                ?: insertSeat(partyId, name, mine[name.lowercase()], nextPosition++, NewSeat(standing = false), context)
        PartyWeekSeat.insert {
            it[PartyWeekSeat.partyId] = partyId
            it[weekStart] = week
            it[memberId] = seatId
            it[shares] = pinned[seatId]
        }
    }
}
