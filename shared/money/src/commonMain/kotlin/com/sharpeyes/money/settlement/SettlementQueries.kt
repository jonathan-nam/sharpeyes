package com.sharpeyes.money.settlement

import com.sharpeyes.money.SettlementDebt
import com.sharpeyes.money.coupons.HolderLedger
import com.sharpeyes.money.coupons.SELF
import com.sharpeyes.money.split.Owings
import kotlinx.serialization.Serializable
import kotlin.math.max

// What a card can be asked: what an offset would do, what closing the coupon pair covers, what the
// whole list comes to. The port of the remaining readers in frontend/lib/settlement.ts.

/** What closing the coupon books with one person would cover, in nights. */
@Serializable
data class PairSettlement(
    val theirs: List<String>,
    val yours: List<String>,
    val shared: Double,
    val offered: Boolean,
)

/** A payout row: which drop, which seat. */
@Serializable
data class PayoutRef(
    val lootId: String,
    val memberId: String,
)

/** One share an offset discharged, resolved for the card. */
@Serializable
data class OffsetShare(
    val key: String,
    val lootId: String,
    val memberId: String,
    val item: String,
    val iconUrl: String? = null,
    val boss: String,
    val members: List<String>,
    val on: String,
    override val weekStart: String,
    override val share: Double,
    val sale: Double? = null,
    val currency: String,
    val partyId: String,
) : WeekShare

/** One share an offset will discharge, and the row it will be recorded as. */
@Serializable
data class OffsetPart(
    val lootId: String,
    val memberId: String,
    val amount: Double,
)

@Serializable
data class Offset(
    val parts: List<OffsetPart>,
    val amount: Double,
    val toComeOff: Double,
    val leftOwing: Double,
    val offered: Boolean,
)

@Serializable
data class SplittableDebt(
    val debt: SettlementDebt,
    val parts: List<OffsetPart>,
)

@Serializable
data class SettlementTotals(
    val owed: Double,
    val owe: Double,
    val net: Double,
    val people: Double,
    val usd: Owings,
)

/** The nights one handover finishes, both directions. A night owing a third person is left out. */
fun settleThePair(row: Settlement): PairSettlement {
    val theirs = row.drops.filterNot { it.shared }.map { it.lootId }
    // One night can owe them twice, off two transfers, and it is one drop and one closure.
    val yours =
        row.owedDrops
            .filterNot { it.shared }
            .map { it.lootId }
            .distinct()
    val shared =
        row.drops.count { it.shared } +
            row.owedDrops
                .filter { it.shared }
                .map { it.lootId }
                .distinct()
                .size
    val offered = theirs.size + yours.size > 0 && (row.pieces > 0 || row.piecesYouOwe > 0)
    return PairSettlement(theirs, yours, shared.toDouble(), offered)
}

/** Every payout row this card's shares would mark paid. */
fun sharesOf(row: Settlement): List<PayoutRef> = row.lines.map { PayoutRef(it.lootId, it.payeeId) }

/** The payout rows for the shares YOU owe. */
fun owedByYouShares(row: Settlement): List<PayoutRef> =
    row.lines.filter { it.direction == "owe" }.map { PayoutRef(it.lootId, it.payeeId) }

/** How a resolved share is keyed. */
fun shareKey(
    lootId: String,
    memberId: String,
): String = "$lootId:$memberId"

/**
 * Entries written as one row over several shares, with the rows each should have been. Refused unless
 * every share resolves, no other entry names one of them, and they add up to the entry exactly.
 */
fun splittableDebts(
    debts: List<SettlementDebt>,
    offsetShares: Map<String, OffsetShare>,
): List<SplittableDebt> {
    val claims = HashMap<String, Int>()
    for (payout in debts.flatMap { it.payouts }) {
        val key = shareKey(payout.lootId, payout.memberId)
        claims[key] = (claims[key] ?: 0) + 1
    }
    return debts.filter { it.amount < 0 && it.payouts.size >= 2 }.mapNotNull { debt ->
        val shares = debt.payouts.map { offsetShares[shareKey(it.lootId, it.memberId)] }
        val refused =
            debt.payouts.indices.any {
                shares[it] == null ||
                    (claims[shareKey(debt.payouts[it].lootId, debt.payouts[it].memberId)] ?: 0) > 1
            }
        val parts =
            if (refused) {
                null
            } else {
                debt.payouts.mapIndexed {
                        i,
                        p,
                    ->
                    OffsetPart(p.lootId, p.memberId, shares[i]!!.share)
                }
            }
        parts
            ?.takeIf {
                it.fold(
                    0.0,
                ) { sum, part -> sum + part.amount } == -debt.amount
            }?.let { SplittableDebt(debt, it) }
    }
}

/** The account's position, summed off the cards. Pieces are not in it. */
fun settlementTotals(rows: List<Settlement>): SettlementTotals {
    val owed = rows.fold(0.0) { sum, row -> sum + row.mesos }
    val owe = rows.fold(0.0) { sum, row -> sum + row.owedByYou + row.sharesYouOwe }
    val usdOwed = rows.fold(0.0) { sum, row -> sum + row.usd.owed }
    val usdOwe = rows.fold(0.0) { sum, row -> sum + row.usd.owe }
    return SettlementTotals(owed, owe, owed - owe, rows.size.toDouble(), Owings(usdOwe, usdOwed, usdOwed - usdOwe))
}

/** What discharging the meso shares you owe against what they owe you would come to. */
fun offsetOf(row: Settlement): Offset {
    val parts =
        row.lines
            .filter {
                it.direction == "owe" && it.currency == "MESO"
            }.map { OffsetPart(it.lootId, it.payeeId, it.pay) }
    val amount = parts.fold(0.0) { sum, part -> sum + part.amount }
    val toComeOff = row.mesos - row.owedByYou
    return Offset(parts, amount, toComeOff, max(0.0, amount - toComeOff), amount > 0 && toComeOff > 0)
}

/** Nothing stands between you either way. */
fun isEmpty(row: Settlement): Boolean =
    listOf(row.pieces, row.piecesYouOwe, row.mesos, row.owedByYou, row.sharesYouOwe, row.usd.owed, row.usd.owe).all {
        it ==
            0.0
    }

/** Your own piles: the only ones you can sell out of. */
fun yourPiles(ledgers: List<HolderLedger>): List<HolderLedger> = ledgers.filter { it.holder.kind == SELF }
