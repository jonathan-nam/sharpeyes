package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.max

// What a pile still owes each creditor once their answered sales and your coupons they hold are spent
// over its nights. The port of spendAnswered and its readers in frontend/lib/ledger-fates.ts.

@Serializable
data class OwedRow(
    val key: String,
    val name: String,
    val pieces: Double,
)

@Serializable
data class SpentNights(
    val nights: List<LedgerEntry>,
    @Serializable(with = TaggedSetSerializer::class)
    val folded: Set<String>,
    @Serializable(with = TaggedMapSerializer::class)
    val left: Map<String, Double>,
)

@Serializable
data class NightQueue(
    val owing: List<LedgerEntry>,
    val clean: Double,
    val answered: Double,
)

/** One creditor's transfer off one night, as the spends read it. [at] is (night, transfer). */
private data class OwedTransfer(
    override val droppedOn: String,
    override val recordedAt: String?,
    override val pieces: Double,
    val at: Pair<Int, Int>,
) : Night<OwedTransfer> {
    override val lootId: String? get() = null

    override fun withPieces(pieces: Double) = copy(pieces = pieces)
}

/** Each creditor's answered sales spent newest first, then what they hold of yours oldest first. */
fun spendAnswered(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): SpentNights {
    val open = ledger.drops.filter { !it.closed && it.transfers.isNotEmpty() }
    val creditors = open.flatMap { d -> d.transfers.map { it.toId } }.distinct()
    val remaining = HashMap<Pair<Int, Int>, Double>()
    val left = LinkedHashMap<String, Double>()
    for (creditor in creditors) {
        val owed =
            open.flatMapIndexed { n, night ->
                night.transfers.mapIndexedNotNull { t, transfer ->
                    if (transfer.toId ==
                        creditor
                    ) {
                        OwedTransfer(night.droppedOn, night.recordedAt, transfer.pieces, n to t)
                    } else {
                        null
                    }
                }
            }
        val sold = spendSales(owed, ledger.answeredByCreditor[creditor] ?: emptyList())
        var over = 0.0
        for (row in spendOldestFirst(sold, heldOfYours[creditor] ?: 0.0)) {
            remaining[row.at] = row.pieces
            over += row.pieces
        }
        left[creditor] = over
    }
    val nights = open.mapIndexed { n, night -> respent(night, n, remaining) }
    val folded =
        nights
            .filter { n ->
                n.transfers.all { it.pieces == 0.0 }
            }.map { it.lootId }
            .toCollection(LinkedHashSet())
    return SpentNights(nights, folded, left)
}

/** Night [n] with each transfer at what the spends left of it. */
private fun respent(
    night: LedgerEntry,
    n: Int,
    remaining: Map<Pair<Int, Int>, Double>,
): LedgerEntry {
    val transfers =
        night.transfers.mapIndexed { t, transfer ->
            val left = remaining[n to t] ?: transfer.pieces
            transfer.copy(pieces = left)
        }
    return night.copy(transfers = transfers)
}

/** The nights still owing, how many owed nothing, and how many the answers retired. */
fun queueOf(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): NightQueue {
    val open = ledger.drops.filterNot { it.closed }
    val (nights, folded) = spendAnswered(ledger, heldOfYours)
    return NightQueue(
        nights.filter { it.lootId !in folded },
        (open.size - nights.size).toDouble(),
        folded.size.toDouble(),
    )
}

/** What the pile still owes in all, less sold pieces that named nobody. */
fun outstandingOf(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): Double {
    val total = spendAnswered(ledger, heldOfYours).left.values.fold(0.0) { sum, p -> sum + p }
    return max(0.0, total - unattributed(ledger))
}

/** Each creditor the pile still owes, biggest first. */
fun owedByCreditor(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): List<OwedRow> {
    val spent = spendAnswered(ledger, heldOfYours)
    val names = HashMap<String, String>()
    for (transfer in spent.nights.flatMap { it.transfers }) names[transfer.toId] = transfer.to
    return spent.left
        .map { (key, pieces) -> OwedRow(key, names[key] ?: key, pieces) }
        .filter { it.pieces > 0 }
        .sortedWith { a, b -> compareNumbers(b.pieces - a.pieces).takeIf { it != 0 } ?: localeCompare(a.name, b.name) }
}

private fun unattributed(ledger: HolderLedger): Double {
    val named = ledger.answeredByCreditor.values.fold(0.0) { sum, sales -> sum + piecesOf(sales) }
    return max(0.0, ledger.answered - named)
}

internal fun piecesOf(sales: List<AnsweredSale>?): Double =
    (sales ?: emptyList()).fold(0.0) { sum, sale ->
        sum +
            sale.pieces
    }
