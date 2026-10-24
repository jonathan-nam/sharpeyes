package com.sharpeyes.money.pieces

import com.sharpeyes.money.VestigeTranche
import com.sharpeyes.money.compareNumbers
import com.sharpeyes.money.coupons.HolderLedger
import com.sharpeyes.money.coupons.SELF
import com.sharpeyes.money.coupons.SELF_KEY
import com.sharpeyes.money.coupons.holderKey
import com.sharpeyes.money.coupons.unaccounted
import com.sharpeyes.money.localeCompare
import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.min

// What a pile can be told became of its pieces, and how many each answer has room for. The port of
// frontend/lib/ledger-fates.ts, less the night spending (AnsweredNights.kt).

/** SOLD, KEPT or BOUGHT. */
val FATES = listOf("SOLD", "KEPT", "BOUGHT")

@Serializable
data class Distributed<T>(
    val creditor: T,
    val pieces: Double,
)

/** How many pieces one fate has room for. */
fun roomFor(
    ledger: HolderLedger,
    fate: String,
): Double {
    val left = unaccounted(ledger)
    return when (fate) {
        "KEPT" -> min(left, max(0.0, ledger.ownShare - ledger.kept))
        "BOUGHT" -> min(left, max(0.0, ledger.pieces - ledger.ownShare - ledger.bought.pieces))
        else -> left
    }
}

fun coversThePile(ledger: HolderLedger): Boolean =
    roomFor(ledger, "KEPT") + roomFor(ledger, "BOUGHT") >= unaccounted(ledger)

/** Pieces the pile owes across its open drops, less what each creditor holds of yours. */
fun owes(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): Double {
    val byCreditor = LinkedHashMap<String, Double>()
    for (transfer in ledger.drops.filterNot { it.closed }.flatMap { it.transfers }) {
        byCreditor[transfer.toId] = (byCreditor[transfer.toId] ?: 0.0) + transfer.pieces
    }
    return byCreditor.entries.fold(0.0) { total, (creditor, pieces) ->
        total +
            max(0.0, pieces - (heldOfYours[creditor] ?: 0.0))
    }
}

/** Coupons of yours each other holder is sitting on, after their own sales of them. */
fun heldOfYoursBy(ledgers: List<HolderLedger>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    for (ledger in ledgers.filter { it.holder.kind != SELF && !it.closed }) {
        val answered = min(ledger.owedToYou, piecesOf(ledger.answeredByCreditor[SELF_KEY]))
        val held = ledger.owedToYou - answered
        if (held > 0) out[holderKey(ledger.holder)] = held
    }
    return out
}

/** A sale's pieces handed to creditors, biggest debt first. */
fun <T> distributeSale(
    pieces: Double,
    creditors: List<T>,
    keyOf: (T) -> String,
    piecesOf: (T) -> Double,
): List<Distributed<T>> {
    var left = max(0.0, pieces)
    val out = mutableListOf<Distributed<T>>()
    val order =
        creditors.sortedWith { a, b ->
            compareNumbers(piecesOf(b) - piecesOf(a)).takeIf { it != 0 } ?: localeCompare(keyOf(a), keyOf(b))
        }
    for (creditor in order.filter { piecesOf(it) > 0 }) {
        if (left <= 0) break
        val cut = min(left, piecesOf(creditor))
        out += Distributed(creditor, cut)
        left = pieces(left - cut)
    }
    return out
}

fun settledOf(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): Double = owes(ledger, heldOfYours) - outstandingOf(ledger, heldOfYours)

fun asksAnything(
    ledger: HolderLedger,
    heldOfYours: Map<String, Double> = emptyMap(),
): Boolean = outstandingOf(ledger, heldOfYours) > 0 || ledger.accounted > ledger.pieces

/** Your piles split into the ones worth a card and the ones with nothing to say. */
fun worthDrawing(
    yours: List<HolderLedger>,
    recorded: (String) -> Boolean,
    heldOfYours: Map<String, Double> = emptyMap(),
): Pair<List<HolderLedger>, List<HolderLedger>> =
    yours.partition { !it.closed && (asksAnything(it, heldOfYours) || recorded(holderKey(it.holder))) }

/** The tranches still waiting on a decision about at least one creditor they named. */
fun stillAsking(
    tranches: List<VestigeTranche>,
    decided: Map<String, Set<String>>,
): List<VestigeTranche> =
    tranches.filter { tranche ->
        val pile = holderKey(tranche.holder)
        val named = (tranche.shares ?: emptyList()).map { holderKey(it.holder) }.filter { it != pile }
        !(named.isNotEmpty() && named.all { decided[tranche.id]?.contains(it) == true })
    }
