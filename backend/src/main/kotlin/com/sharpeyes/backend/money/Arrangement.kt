package com.sharpeyes.backend.money

import kotlin.math.floor

// What to suggest before anybody says how a night was looted, and how far behind each holder is. The
// port of runningBalance and suggestArrangement in frontend/lib/vestige-ledger.ts. A suggestion only:
// nothing is written until somebody says this is what happened.

/** How far ahead or behind each holder is across every drop already answered for. Once per drop. */
fun runningBalance(drops: List<OutstandingDrop>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    for (d in drops.distinctBy { it.lootId }) {
        for (b in balances(d.drop.total, d.drop.seats)) out[b.memberId] = (out[b.memberId] ?: 0.0) + b.balance
    }
    return out
}

/** The balanced arrangement to suggest, the odd stack going to whoever is furthest behind. */
fun suggestArrangement(
    bundles: Double,
    seats: List<PartyMember>,
    behind: Map<String, Double>,
): Map<String, Double> {
    val weight = seats.fold(0.0) { sum, s -> sum + s.shares }
    if (seats.isEmpty() || weight <= 0 || bundles <= 0) return emptyMap()
    val exact = seats.map { (bundles * it.shares) / weight }
    val share = exact.map { floor(it) }.toMutableList()
    var left = bundles - share.fold(0.0) { sum, n -> sum + n }
    val order =
        seats.indices.sortedWith { a, b ->
            compareNumbers((exact[b] - share[b]) - (exact[a] - share[a])).takeIf { it != 0 }
                ?: compareNumbers(owedOf(behind, seats[b]) - owedOf(behind, seats[a])).takeIf { it != 0 }
                ?: (a - b)
        }
    for (i in order) {
        if (left <= 0) break
        share[i] += 1
        left -= 1
    }
    // A seat with no stacks is left out rather than given a zero.
    val out = LinkedHashMap<String, Double>()
    seats.forEachIndexed { i, s -> if (share[i] > 0) out[s.id] = share[i] }
    return out
}

/** The seat's holder's position: two characters of one person are one pile. */
private fun owedOf(
    behind: Map<String, Double>,
    seat: PartyMember,
): Double = behind[holderKey(holderOf(seat))] ?: 0.0
