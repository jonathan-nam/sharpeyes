package com.sharpeyes.money

import kotlin.math.min

// What the tranches say about each pile: pieces sold, kept, bought, and answered with money. The port
// of the tally half of frontend/lib/vestige-ledger.ts. A sale is a row with an amount; a redemption has
// none; only a purchase needs its disposition, read positively so an older row is never one.

private const val BOUGHT = "BOUGHT"

internal fun isBought(row: VestigeTranche): Boolean = row.disposition == BOUGHT

private fun MutableMap<String, Double>.add(
    key: String,
    value: Double,
) {
    this[key] = (this[key] ?: 0.0) + value
}

/** Pieces each holder has SOLD: rows with money, minus the purchases. */
fun salesByHolder(rows: List<VestigeTranche>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    rows.filter { it.amount != null && !isBought(it) }.forEach { out.add(holderKey(it.holder), it.pieces) }
    return out
}

/** Pieces each holder is redeeming rather than selling: rows with no money. */
fun keptByHolder(rows: List<VestigeTranche>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    rows.filter { it.amount == null }.forEach { out.add(holderKey(it.holder), it.pieces) }
    return out
}

/** Pieces of the creditor's each holder bought, and what they paid. */
fun boughtByHolder(rows: List<VestigeTranche>): Map<String, BoughtPieces> {
    val out = LinkedHashMap<String, BoughtPieces>()
    for (row in rows.filter { isBought(it) && it.amount != null }) {
        val key = holderKey(row.holder)
        val seen = out[key]
        out[key] = BoughtPieces((seen?.pieces ?: 0.0) + row.pieces, (seen?.paid ?: 0.0) + row.amount!!)
    }
    return out
}

/** Pieces of each pile answered with money: shares a priced tranche named, or a purchase naming nobody. */
fun answeredByHolder(rows: List<VestigeTranche>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    for (row in rows.filter { it.amount != null }) {
        val key = holderKey(row.holder)
        val named =
            (row.shares ?: emptyList()).filter { holderKey(it.holder) != key }.fold(0.0) { sum, s ->
                sum +
                    s.pieces
            }
        val answered =
            when {
                named > 0 -> min(named, row.pieces)
                isBought(row) -> row.pieces
                else -> 0.0
            }
        if (answered > 0) out.add(key, answered)
    }
    return out
}

/** How one pile's answer to one creditor is keyed. */
fun answeredKey(
    pile: String,
    creditor: String,
): String = "$pile|$creditor"

/** The same pieces per (pile, creditor), summed. */
fun answeredByPair(rows: List<VestigeTranche>): Map<String, Double> =
    answeredSalesByPair(
        rows,
    ).mapValuesTo(LinkedHashMap()) { (_, sales) -> sales.fold(0.0) { sum, s -> sum + s.pieces } }

/** One entry per SALE per (pile, creditor), capped against the tranche in share order. */
fun answeredSalesByPair(rows: List<VestigeTranche>): Map<String, List<AnsweredSale>> {
    val out = LinkedHashMap<String, MutableList<AnsweredSale>>()
    for (row in rows.filter { it.amount != null }) {
        val pile = holderKey(row.holder)
        var left = row.pieces
        // A share naming the pile's own holder answers nothing and spends none of the budget.
        val named = (row.shares ?: emptyList()).filter { holderKey(it.holder) != pile }
        for (share in named) {
            if (left <= 0) break
            val pieces = min(share.pieces, left)
            left -= pieces
            out.getOrPut(answeredKey(pile, holderKey(share.holder))) { mutableListOf() } +=
                AnsweredSale(pieces, row.soldAt ?: "")
        }
    }
    return out
}
