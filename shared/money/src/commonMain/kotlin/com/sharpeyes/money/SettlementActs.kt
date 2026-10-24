package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.abs

// The acts on a card: what came off what they owe, which coupon sales each decision was made of, and
// which sales are still waiting on one. The port of moneyRows and its helpers in settlement.ts.

/** One act that has already come off what they owe you. */
@Serializable
data class Discharge(
    val id: String,
    /** DEBT, PROCEEDS or PAYMENT: which ledger it lives in. */
    val source: String,
    /** Mesos it took off. Positive, so a list of them adds up to what has come off. */
    val amount: Double,
    val label: String,
    val at: String,
    val payouts: List<SettlementDebtPayout>,
    val sales: List<CouponSale>,
    /** Who wrote it, when the other side of a shared book did. */
    val by: String? = null,
)

/** What builds the debt, and what has come off it. */
@Serializable
data class MoneyRows(
    val typed: List<SettlementDebt>,
    val discharges: List<Discharge>,
    val discharged: Double,
)

/** Whether a decision is about money of yours they hold, rather than theirs you hold. */
fun heldByThem(disposal: ProceedsDisposal): Boolean = disposal.heldBy == "THEM"

/** The purchases somebody else's pile has recorded against YOUR coupons, per holder. */
fun keptOfYours(tranches: List<VestigeTranche>): Map<String, List<VestigeTranche>> {
    val out = LinkedHashMap<String, MutableList<VestigeTranche>>()
    for (tranche in tranches) {
        val pile = holderKey(tranche.holder)
        val namesYou = (tranche.shares ?: emptyList()).any { holderKey(it.holder) == SELF_KEY }
        if (pile != SELF_KEY && namesYou) out.getOrPut(pile) { mutableListOf() } += tranche
    }
    return out
}

/**
 * Which coupon sales each decision was made of: whole sales taken off the front, oldest first, landing
 * exactly on the amount. Where the alignment goes, that decision and every later one get nothing.
 */
private fun couponSalesBehind(
    sales: List<CouponSale>,
    disposals: List<ProceedsDisposal>,
): Map<String, List<CouponSale>> {
    val out = LinkedHashMap<String, List<CouponSale>>()
    var next = 0
    for (disposal in disposals) {
        val taken = mutableListOf<CouponSale>()
        var sum = 0.0
        while (sum < disposal.amount && next < sales.size) {
            sum += sales[next].mesos
            taken += sales[next]
            next += 1
        }
        if (sum != disposal.amount) break
        out[disposal.id] = taken
    }
    return out
}

/** Which sales somebody has said what happens to the money of, and for whom. Per creditor. */
fun decidedSales(
    credits: Map<String, SaleCredit>,
    disposals: List<ProceedsDisposal>,
): Map<String, Set<String>> {
    val out = LinkedHashMap<String, MutableSet<String>>()

    fun decide(
        sales: List<CouponSale>,
        by: List<ProceedsDisposal>,
        creditor: String,
    ) {
        for (sale in couponSalesBehind(sales, by).values.flatten()) {
            out.getOrPut(sale.trancheId) { LinkedHashSet() } +=
                creditor
        }
    }
    for ((key, credit) in credits) {
        val theirs = disposals.filter { holderKey(it.holder) == key }
        decide(credit.sales, theirs.filterNot(::heldByThem), key)
        decide(credit.salesToYou ?: emptyList(), theirs.filter(::heldByThem), SELF_KEY)
    }
    return out
}

/** The coupon sales the money you still hold came out of: the tail past every decision, or none. */
fun undecidedSales(
    sales: List<CouponSale>,
    holding: Double,
): List<CouponSale> {
    val decided = sales.fold(0.0) { sum, sale -> sum + sale.mesos } - holding
    var spent = 0.0
    var next = 0
    while (spent < decided && next < sales.size) {
        spent += sales[next].mesos
        next += 1
    }
    return if (spent != decided) emptyList() else sales.drop(next)
}

/** The other side of a shared book, when they wrote this row; null when you did. */
private fun writerOf(
    recordedByYou: Boolean?,
    recordedByName: String?,
): String? = if (recordedByYou == false) recordedByName ?: "" else null

/** The money rows split by what they are: what builds the debt, and what has come off it, newest first. */
fun moneyRows(
    row: Settlement,
    received: List<VestigePayment> = emptyList(),
): MoneyRows {
    val (typed, offsets) = row.entries.partition { it.payouts.isEmpty() }
    val discharges = mutableListOf<Discharge>()
    for (entry in offsets) {
        discharges +=
            Discharge(
                entry.id,
                "DEBT",
                abs(entry.amount),
                entry.note ?: "offset",
                entry.incurredAt,
                entry.payouts,
                emptyList(),
                writerOf(entry.recordedByYou, entry.recordedByName),
            )
    }
    // Every decision spent held money, so the matching sees them all; only offsets get a row.
    val behind =
        couponSalesBehind(row.sales, row.disposals.filterNot(::heldByThem)) +
            couponSalesBehind(row.salesHeldByThem, row.disposals.filter(::heldByThem))
    for (disposal in row.disposals.filter { it.kind == "OFFSET" }) {
        val amount = if (heldByThem(disposal)) -disposal.amount else disposal.amount
        val by = writerOf(disposal.recordedByYou, disposal.recordedByName)
        discharges +=
            Discharge(
                disposal.id,
                "PROCEEDS",
                amount,
                "coupon sale",
                disposal.decidedAt,
                emptyList(),
                behind[disposal.id] ?: emptyList(),
                by,
            )
    }
    for (got in received) {
        val label = got.note ?: if (got.amount < 0) "you paid" else "paid"
        discharges +=
            Discharge(
                got.id,
                "PAYMENT",
                got.amount,
                label,
                got.receivedAt,
                emptyList(),
                emptyList(),
                writerOf(got.recordedByYou, got.recordedByName),
            )
    }
    val sorted =
        discharges.sortedWith { a, b ->
            localeCompare(b.at, a.at).takeIf { it != 0 }
                ?: localeCompare(a.id, b.id)
        }
    return MoneyRows(typed, sorted, sorted.fold(0.0) { sum, d -> sum + d.amount })
}
