package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.floor
import kotlin.math.min

// Who owes whom when a drop arrives in pieces. The port of frontend/lib/piece-ledger.ts, which
// explains each rule; this file keeps the arithmetic and only the comments the code needs.

/** One seat on a stacking drop: what they took, and their weight in the even share. */
@Serializable
data class LedgerSeat(
    val memberId: String,
    val name: String,
    val looted: Double,
    val shares: Double,
)

@Serializable
data class SeatBalance(
    val memberId: String,
    val name: String,
    val entitled: Double,
    val looted: Double,
    /** Pieces owed TO them. Negative is holding that many that are not theirs. */
    val balance: Double,
)

@Serializable
data class PieceTransfer(
    val fromId: String,
    val toId: String,
    val from: String,
    val to: String,
    val pieces: Double,
)

@Serializable
data class BoughtPieces(
    val pieces: Double,
    val paid: Double,
)

@Serializable
data class LedgerDrop(
    val id: String,
    val weekStart: String,
    val order: Double,
    val total: Double,
    val seats: List<LedgerSeat>,
    /** Pieces of it in this row's pile. Absent is `total`. */
    val held: Double? = null,
    val kept: Double? = null,
    val bought: BoughtPieces? = null,
)

/** One sale's coupons, with the moment it was recorded. */
@Serializable
data class AnsweredSale(
    val pieces: Double,
    val recordedAt: String,
)

/** A whole divided by weights, in whole units that add up to exactly the whole. */
fun largestRemainder(
    total: Double,
    weights: List<Double>,
): List<Double> {
    val weight = weights.fold(0.0) { sum, w -> sum + w }
    if (weights.isEmpty() || weight <= 0 || total <= 0) return weights.map { 0.0 }
    val exact = weights.map { (total * it) / weight }
    val share = exact.map { floor(it) }.toMutableList()
    var left = total - share.sum()
    val order =
        exact
            .mapIndexed { i, value -> i to value - share[i] }
            .sortedWith { a, b -> compareNumbers(b.second - a.second).takeIf { it != 0 } ?: (a.first - b.first) }
    for ((i, _) in order) {
        if (left <= 0) break
        share[i] = share[i] + 1
        left -= 1
    }
    return share
}

/** How finely a coupon count is held: exact for every share a party can have to two decimals. */
private const val PIECES_PER_COUPON = 1e6

/** A count of coupons, held to the millionth of one. */
fun pieces(n: Double): Double = jsRound(n * PIECES_PER_COUPON) / PIECES_PER_COUPON

/** What each seat was entitled to, exactly: 45 across two is 22.5 each. Keyed in seat order. */
fun entitlements(
    total: Double,
    seats: List<LedgerSeat>,
): Map<String, Double> {
    val weight = seats.fold(0.0) { sum, s -> sum + s.shares }
    if (weight <= 0 ||
        total <= 0
    ) {
        return LinkedHashMap<String, Double>().apply { seats.forEach { put(it.memberId, 0.0) } }
    }
    val share = seats.map { pieces((total * it.shares) / weight) }.toMutableList()
    // The last seat with a share takes what makes it add up.
    val last = seats.indexOfLast { it.shares > 0 }
    if (last >= 0) {
        share[last] = pieces(total - share.foldIndexed(0.0) { i, sum, n -> if (i == last) sum else sum + n })
    }
    val out = LinkedHashMap<String, Double>()
    seats.forEachIndexed { i, s -> out[s.memberId] = share[i] }
    return out
}

fun balances(
    total: Double,
    seats: List<LedgerSeat>,
): List<SeatBalance> {
    val entitled = entitlements(total, seats)
    return seats.map { s ->
        val owed = entitled[s.memberId] ?: 0.0
        SeatBalance(s.memberId, s.name, owed, s.looted, pieces(owed - s.looted))
    }
}

/** Pieces in the pile a row is about. */
fun heldOf(drop: LedgerDrop): Double = drop.held ?: drop.total

/** Pieces of this pile that are the holder's OWN. Absent holder reads the pile as all theirs. */
fun ownShareOf(
    drop: LedgerDrop,
    holder: String? = null,
): Double {
    if (holder == null) return heldOf(drop)
    return min(heldOf(drop), entitlements(drop.total, drop.seats)[holder] ?: 0.0)
}

/** Who owes whom out of one drop: seats over their share pay seats under it, both in seat order. */
fun transfersOf(
    drop: LedgerDrop,
    from: String? = null,
): List<PieceTransfer> {
    val position = balances(drop.total, drop.seats)
    val owing = position.filter { it.balance < 0 }.map { it to doubleArrayOf(-it.balance) }
    val owed = position.filter { it.balance > 0 }.map { it to doubleArrayOf(it.balance) }
    val out = mutableListOf<PieceTransfer>()
    var step = 0
    for ((debtor, debtorLeft) in owing) {
        while (debtorLeft[0] > 0 && step < owed.size) {
            val (creditor, creditorLeft) = owed[step]
            val moved = min(debtorLeft[0], creditorLeft[0])
            out += PieceTransfer(debtor.memberId, creditor.memberId, debtor.name, creditor.name, moved)
            debtorLeft[0] = pieces(debtorLeft[0] - moved)
            creditorLeft[0] = pieces(creditorLeft[0] - moved)
            if (creditorLeft[0] <= 0) step += 1
        }
    }
    return if (from == null) out else out.filter { it.fromId == from }
}

fun transferKey(transfer: PieceTransfer): String = "${transfer.fromId}>${transfer.toId}"
