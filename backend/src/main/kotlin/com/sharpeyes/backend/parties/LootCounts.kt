package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootPayout
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// What a party row says about its pool: what is waiting, what is owed, and what is done.
//
// Split from the pool READS in LootQueries.kt. The queries here are two lines; the rule is the four
// predicates in countsOf, and each of them has been got wrong at least once in a way that put a
// plausible number on a card rather than an error on screen.

/** Unsold drops, sold ones with a share of yours still unpaid, and ones with nothing left to do. */
internal data class LootCounts(
    val pending: Int,
    val awaitingPayout: Int,
    // Sold and every share of yours paid. Carried so a pool that is fully settled is still VISIBLE from the
    // list: with only the two counters above, marking the last share paid made a party's whole
    // drop history vanish from its row, and there was nothing to say the pool was not empty.
    val settled: Int,
)

private data class LootRow(
    val id: Uuid,
    val partyId: Uuid,
    val droppedOn: LocalDate,
    val sold: Boolean,
    val sellerMemberId: Uuid?,
    // Somebody has the item. The Heroic end-state, and terminal in the same way `sold` plus every
    // payout paid is: nothing further is owed or expected.
    val taken: Boolean,
)

/**
 * The pool counts per config, for one week or for all time.
 *
 * A null [week] counts every drop the pool has ever held, which is what the party's own page and
 * the delete guard want. Otherwise a drop belongs to the week it fell in, so a week that has passed
 * shows the pool it had rather than today's.
 *
 * Outstanding drops are the one exception to that, and they carry FORWARD: something unsold, or
 * sold with somebody still unpaid, is work left to do rather than history, so it keeps counting in
 * every later week until it settles. Otherwise a drop from last week that still owes somebody money
 * would disappear from Party View entirely, which is the silent-omission failure this repo exists
 * to prevent.
 *
 * Nothing carries backwards. A drop that fell after the week being shown is not in that week, so a
 * settled pool stays settled when you step back to it.
 *
 * "Awaiting payout" is derived the same way the loot rows derive their status (statusOf): sold, and
 * at least one share through one of your own seats unpaid. Deriving it in one place and storing it
 * in none is what keeps the card's badge and the drop's own status from disagreeing.
 */
internal fun lootCountsFor(
    partyIds: List<Uuid>,
    week: LocalDate?,
    // Who is counting: a member counts only what they read, from their own seats. Null counts as
    // each party's owner. See MemberReads.
    reader: String? = null,
): Map<Uuid, LootCounts> {
    val reads = reader?.let { dropsReadBy(it, partyIds) } ?: { _, _ -> true }
    val loot =
        if (partyIds.isEmpty()) {
            emptyList()
        } else {
            PartyLoot
                .selectAll()
                .where { PartyLoot.partyId inList partyIds }
                .map {
                    LootRow(
                        it[PartyLoot.id],
                        it[PartyLoot.partyId],
                        it[PartyLoot.droppedOn],
                        it[PartyLoot.soldAt] != null,
                        it[PartyLoot.sellerMemberId],
                        it[PartyLoot.takenByMemberId] != null,
                    )
                }.filter { reads(it.partyId, it.droppedOn) }
        }
    if (loot.isEmpty()) return emptyMap()

    // Only shares that pass through your own seats hold a drop open. One between two other members
    // is theirs to settle, and waiting on it left the drop awaiting payout with nothing to do.
    val mine = reader?.let { readerSeatsIn(partyIds, it) } ?: ownSeatsIn(partyIds)
    val sellerOf = loot.associate { it.id to it.sellerMemberId }
    val unpaidLootIds =
        PartyLootPayout
            .selectAll()
            .where { (PartyLootPayout.lootId inList loot.map { it.id }) and (PartyLootPayout.paid eq false) }
            .filter { it[PartyLootPayout.memberId] in mine || sellerOf[it[PartyLootPayout.lootId]] in mine }
            .map { it[PartyLootPayout.lootId] }
            .toSet()
    val inPieces = pieceLootIds(partyIds)

    return loot
        .groupBy { it.partyId }
        .mapValues { (_, rows) -> countsOf(rows, inPieces, unpaidLootIds, week) }
}

/**
 * One party's three counts, given the rows and what is known about them.
 *
 * Split out of lootCountsFor because the four predicates below are the whole of the rule and the
 * queries above are the whole of the plumbing, and reading either meant reading both.
 */
private fun countsOf(
    rows: List<LootRow>,
    inPieces: Set<Uuid>,
    unpaidLootIds: Set<Uuid>,
    week: LocalDate?,
): LootCounts {
    // Drops still waiting to be SOLD. A drop that comes in pieces is never one of them, whoever is
    // holding it: it settles through the tranche ledger, and the party row says what it is owed in
    // COUPONS. Counting it here as well read as two things to do, one coupon drop showing as
    // "1 in the pool · 30 coupons owed". See LootPoolWork.kt.
    //
    // A taken drop is not one either, and for the plainer reason: somebody has it. In a Heroic pool
    // that is the end of the row, so counting it as pending would leave every party permanently
    // showing work it had already finished.
    val outstanding = { row: LootRow -> !row.sold && !row.taken && row.id !in inPieces }

    // Taken drops are finished, the way sold-and-fully-paid ones are. Both have to stay visible
    // from the list or a party's whole history vanishes off its row with the last click.
    val done = { row: LootRow -> row.taken || (row.sold && row.id !in unpaidLootIds) }

    // Through periodAfter rather than a +7, so the week a drop is filed under and the week the
    // stepper walks cannot drift apart.
    val weekEnd = week?.let { periodAfter(WEEKLY_CADENCE, it) }

    // Two windows, and the difference between them is the carry-forward. Outstanding drops count
    // from the week they fell in onwards; settled ones count in that week alone.
    val byThen = { row: LootRow -> weekEnd == null || row.droppedOn < weekEnd }
    val inWeek = { row: LootRow -> week == null || (row.droppedOn >= week && byThen(row)) }

    return LootCounts(
        pending = rows.count { outstanding(it) && byThen(it) },
        awaitingPayout = rows.count { it.sold && it.id in unpaidLootIds && byThen(it) },
        settled = rows.count { done(it) && inWeek(it) },
    )
}
