package com.sharpeyes.money.pieces

import com.sharpeyes.money.localeCompare
import kotlin.math.max
import kotlin.math.min

// Spending a credit or a sale over the nights a debt is made of. The rest of
// frontend/lib/piece-ledger.ts; see PieceLedger.kt for the counts themselves.

/** A night as the spends read it. [withPieces] is the TypeScript's `{ ...night, pieces }`. */
interface Night<T : Night<T>> {
    val pieces: Double
    val droppedOn: String
    val recordedAt: String?
    val lootId: String?

    fun withPieces(pieces: Double): T
}

/** A night that also says which reset week it fell in. */
interface PlaceableNight<T : PlaceableNight<T>> : Night<T> {
    val weekStart: String
}

/** One sale's coupons on one night. */
data class Placed<T>(
    val night: T,
    val pieces: Double,
)

/** The one order every spend runs in: the day it fell, then when it was logged, then its id. */
fun oldestNightFirst(
    a: Night<*>,
    b: Night<*>,
): Int =
    localeCompare(a.droppedOn, b.droppedOn).takeIf { it != 0 }
        ?: localeCompare(a.recordedAt ?: "", b.recordedAt ?: "").takeIf { it != 0 }
        ?: localeCompare(a.lootId ?: "", b.lootId ?: "")

/** A credit spent over nights, oldest first, leaving what each still owes. Every night returned. */
fun <T : Night<T>> spendOldestFirst(
    nights: List<T>,
    credit: Double,
): List<T> {
    var left = max(0.0, credit)
    val owed = DoubleArray(nights.size) { nights[it].pieces }
    for (i in nights.indices.sortedWith { a, b -> oldestNightFirst(nights[a], nights[b]) }) {
        val spent = min(left, nights[i].pieces)
        left -= spent
        owed[i] = nights[i].pieces - spent
    }
    return nights.mapIndexed { i, night -> night.withPieces(owed[i]) }
}

/** Sales spent over nights, each reaching only nights already logged when it was made. Newest first. */
fun <T : Night<T>> spendSales(
    nights: List<T>,
    sales: List<AnsweredSale>,
): List<T> {
    val owed = DoubleArray(nights.size) { nights[it].pieces }
    walkSales(nights, sales) { _, i, spent -> owed[i] -= spent }
    return nights.mapIndexed { i, night -> night.withPieces(owed[i]) }
}

/** The sales' indices in the order they were recorded, which is the order they are spent in. */
private fun recordedOrder(sales: List<AnsweredSale>): List<Int> =
    sales.indices.sortedWith { a, b -> localeCompare(sales[a].recordedAt, sales[b].recordedAt) }

/**
 * The walk spendSales and placeSalesOnNights share. [onSpend] hears the sale's index in [sales], the
 * night's index in [nights], and pieces moved. Returns, per sale, the pieces it could not place.
 *
 * A night with no recordedAt is a row cached from before the field, and stays eligible for everything.
 */
private fun <T : Night<T>> walkSales(
    nights: List<T>,
    sales: List<AnsweredSale>,
    onSpend: (sale: Int, night: Int, spent: Double) -> Unit,
): DoubleArray {
    val owed = DoubleArray(nights.size) { nights[it].pieces }
    val newest = nights.indices.sortedWith { a, b -> oldestNightFirst(nights[a], nights[b]) }.reversed()
    val unplaced = DoubleArray(sales.size)
    for (s in recordedOrder(sales)) {
        val sale = sales[s]
        val eligible =
            newest.filter {
                nights[it].recordedAt.isNullOrEmpty() ||
                    nights[it].recordedAt!! <= sale.recordedAt
            }
        var left = max(0.0, sale.pieces)
        for (i in eligible) {
            if (left <= 0) break
            val spent = min(left, owed[i])
            left -= spent
            owed[i] -= spent
            onSpend(s, i, spent)
        }
        unplaced[s] = left
    }
    return unplaced
}

/**
 * Which nights each sale came off, spending exactly as spendSales does. Null for a sale the nights
 * cannot cover in full. Keyed by the sale's index in [sales], in the order the sales were walked.
 */
fun <T : PlaceableNight<T>> placeSalesOnNights(
    nights: List<T>,
    sales: List<AnsweredSale>,
): Map<Int, List<Placed<T>>?> {
    val taken = sales.indices.associateWith { mutableListOf<Placed<T>>() }
    val unplaced =
        walkSales(nights, sales) { s, i, spent ->
            if (spent > 0) taken.getValue(s) += Placed(nights[i], spent)
        }
    val out = LinkedHashMap<Int, List<Placed<T>>?>()
    for (s in recordedOrder(sales)) out[s] = if (unplaced[s] > 0) null else taken.getValue(s)
    return out
}

/** The same placement folded to the reset weeks the pieces came from. */
fun <T : PlaceableNight<T>> placeSales(
    nights: List<T>,
    sales: List<AnsweredSale>,
): Map<Int, Map<String, Double>?> {
    val out = LinkedHashMap<Int, Map<String, Double>?>()
    for ((sale, taken) in placeSalesOnNights(nights, sales)) {
        out[sale] =
            taken?.let {
                val weeks = LinkedHashMap<String, Double>()
                for ((night, pieces) in it) weeks[night.weekStart] = (weeks[night.weekStart] ?: 0.0) + pieces
                weeks
            }
    }
    return out
}
