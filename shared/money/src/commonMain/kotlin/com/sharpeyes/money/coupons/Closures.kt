package com.sharpeyes.money.coupons

import com.sharpeyes.money.Holder
import com.sharpeyes.money.VestigePayment
import com.sharpeyes.money.VestigeSettlement
import com.sharpeyes.money.localeCompare
import kotlinx.serialization.Serializable
import kotlin.math.max

// Which piles have had their books closed, and the payments no closure has already spoken for. The
// port of the closure half of frontend/lib/vestige-ledger.ts.

/** One holder's receipts, split by whether a closure already spent them. */
@Serializable
data class PaymentSplit(
    val counted: List<VestigePayment>,
    val spent: List<VestigePayment>,
)

/** One holder's pile entry for a loot row, for that row's own display. */
@Serializable
data class LootPile(
    val holderName: String,
    val drop: LedgerEntry,
)

fun closureKey(
    holder: Holder,
    lootId: String,
): String = closureKeyOf(holderKey(holder), lootId)

fun closureKeyOf(
    holder: String,
    lootId: String,
): String = "$holder|$lootId"

/** Every (holder, drop) whose books are closed, and what each holder's acts wrote off. */
fun closedByHolder(rows: List<VestigeSettlement>): Closures {
    val closed = LinkedHashSet<String>()
    val writtenOff = LinkedHashMap<String, Double>()
    for (row in rows) {
        row.lootIds.forEach { closed += closureKey(row.holder, it) }
        val key = holderKey(row.holder)
        writtenOff[key] = (writtenOff[key] ?: 0.0) + row.unpaid
    }
    return Closures(closed, writtenOff)
}

/** The drops a holder still has open. */
fun stillOpen(
    drops: List<OutstandingDrop>,
    closed: Set<String>,
): List<OutstandingDrop> = drops.filter { closureKey(it.holder, it.lootId) !in closed }

/** Mesos each holder has actually handed over. */
fun receivedByHolder(rows: List<VestigePayment>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    for (row in rows) out[holderKey(row.holder)] = (out[holderKey(row.holder)] ?: 0.0) + row.amount
    return out
}

/**
 * The payments no closure has spoken for, per holder, and the ones it has. By time: the holder's last
 * closure is the line, compared as ISO 8601 text, which is chronological. Oldest first.
 */
fun paymentsSinceClosing(
    payments: List<VestigePayment>,
    settlements: List<VestigeSettlement>,
): Map<String, PaymentSplit> {
    val closedAt = LinkedHashMap<String, String>()
    for (row in settlements) {
        val key = holderKey(row.holder)
        val seen = closedAt[key]
        if (seen == null || row.settledAt > seen) closedAt[key] = row.settledAt
    }
    val counted = LinkedHashMap<String, MutableList<VestigePayment>>()
    val spent = LinkedHashMap<String, MutableList<VestigePayment>>()
    for (row in payments.sortedWith { a, b -> localeCompare(a.receivedAt, b.receivedAt) }) {
        val key = holderKey(row.holder)
        val closed = closedAt[key]
        counted.getOrPut(key) { mutableListOf() }
        spent.getOrPut(key) { mutableListOf() }
        if (closed != null && row.receivedAt <= closed) spent.getValue(key) += row else counted.getValue(key) += row
    }
    return counted.mapValuesTo(LinkedHashMap()) { (key, list) -> PaymentSplit(list, spent.getValue(key)) }
}

/** What the receipts since the last closure come to, per holder. */
fun receivedSinceClosing(
    payments: List<VestigePayment>,
    settlements: List<VestigeSettlement>,
): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    for ((key, split) in paymentsSinceClosing(payments, settlements)) {
        if (split.counted.isNotEmpty()) out[key] = split.counted.fold(0.0) { sum, row -> sum + row.amount }
    }
    return out
}

/** Pieces of the pile nobody has said the fate of yet. Floored at zero. */
fun unaccounted(ledger: HolderLedger): Double = max(0.0, ledger.pieces - ledger.accounted)

/** Every pile this loot row sits in. */
fun ledgerForLoot(
    ledgers: List<HolderLedger>,
    lootId: String,
): List<LootPile> =
    ledgers.flatMap { ledger ->
        ledger.drops.filter { it.lootId == lootId }.map { LootPile(ledger.holderName, it) }
    }
