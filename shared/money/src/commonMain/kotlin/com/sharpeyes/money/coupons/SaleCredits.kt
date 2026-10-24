package com.sharpeyes.money.coupons

import com.sharpeyes.money.TrancheShare
import com.sharpeyes.money.VestigeTranche
import com.sharpeyes.money.jsRound
import kotlinx.serialization.Serializable
import kotlin.math.max

// The one place a coupon debt gets a price: a tranche whose price the enterer typed, divided between the
// people whose coupons were in it. The port of saleCredits and couponMoney in vestige-ledger.ts.

/** One priced tranche as far as it concerns one counterparty. */
@Serializable
data class CouponSale(
    val trancheId: String,
    val pieces: Double,
    val mesos: Double,
    val lot: Lot,
    val soldAt: String? = null,
) {
    @Serializable
    data class Lot(
        val pieces: Double,
        val amount: Double,
    )
}

/** What one counterparty's coupon sales came to, in each direction. Mesos only. */
@Serializable
data class SaleCredit(
    val toThem: Double = 0.0,
    val toYou: Double = 0.0,
    val keptByThem: Double? = null,
    val sales: List<CouponSale> = emptyList(),
    val salesToYou: List<CouponSale>? = null,
)

@Serializable
data class CouponMoney(
    val pooled: Double,
    val yourTake: Double,
)

/** Their share of the lot's price, rounded to the meso the way every reader of a sale rounds it. */
private fun shareOf(
    share: TrancheShare,
    row: VestigeTranche,
): Double = jsRound((share.pieces * row.amount!!) / row.pieces)

/** What each counterparty is owed, or owes, out of priced tranches of somebody else's pieces. */
fun saleCredits(rows: List<VestigeTranche>): Map<String, SaleCredit> {
    val out = LinkedHashMap<String, SaleCredit>()
    for (row in rows.filter { it.amount != null && it.pieces >= 1 }) {
        val pile = holderKey(row.holder)
        for (share in row.shares ?: emptyList()) {
            val creditor = holderKey(share.holder)
            if (pile == SELF_KEY || creditor == SELF_KEY) credit(out, row, share, pile, creditor)
        }
    }
    return out
}

private fun credit(
    out: LinkedHashMap<String, SaleCredit>,
    row: VestigeTranche,
    share: TrancheShare,
    pile: String,
    creditor: String,
) {
    val mesos = shareOf(share, row)
    val sale = CouponSale(row.id, share.pieces, mesos, CouponSale.Lot(row.pieces, row.amount!!), row.soldAt)
    when {
        pile == SELF_KEY -> {
            val seen = out[creditor] ?: SaleCredit()
            out[creditor] = seen.copy(toThem = seen.toThem + mesos, sales = seen.sales + sale)
        }
        isBought(row) -> {
            val seen = out[pile] ?: SaleCredit()
            out[pile] = seen.copy(keptByThem = (seen.keptByThem ?: 0.0) + mesos)
        }
        else -> {
            val seen = out[pile] ?: SaleCredit()
            out[pile] = seen.copy(toYou = seen.toYou + mesos, salesToYou = (seen.salesToYou ?: emptyList()) + sale)
        }
    }
}

/** What the coupon piles have fetched, said the way a sold drop says it. */
fun couponMoney(rows: List<VestigeTranche>): CouponMoney {
    var pooled = 0.0
    var yourTake = 0.0
    for (row in rows.filter { it.amount != null && it.pieces >= 1 && !isBought(it) }) {
        val shares = row.shares ?: emptyList()
        val mesosOf = { of: (String) -> Boolean ->
            shares.filter { of(holderKey(it.holder)) }.fold(0.0) { sum, s -> sum + shareOf(s, row) }
        }
        if (holderKey(row.holder) == SELF_KEY) {
            pooled += row.amount!!
            yourTake += max(0.0, row.amount - mesosOf { it != SELF_KEY })
        } else {
            val mine = mesosOf { it == SELF_KEY }
            if (mine != 0.0) {
                pooled += row.amount!!
                yourTake += mine
            }
        }
    }
    return CouponMoney(pooled, yourTake)
}
