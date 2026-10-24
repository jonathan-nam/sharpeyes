package com.sharpeyes.money

import kotlinx.serialization.Serializable

// Selling a pile of one interchangeable drop in one go: which rows a count covers, and what each row's
// slice of the price is. The port of the pricing half of frontend/lib/lot-sale.ts.

@Serializable
data class LotRoster(
    val key: String,
    val names: List<String>,
)

@Serializable
data class LotProposal(
    val rows: List<LotRow>,
    val units: Double,
    val reachable: List<Double>,
)

@Serializable
data class LotSaleRowBody(
    val partyId: String,
    val lootId: String,
    val amount: Double,
    val sellerMemberId: String,
    val shares: Map<String, Double>,
)

@Serializable
data class LotSaleBody(
    val dropKey: String,
    val total: Double,
    val amountBasis: String,
    val splitMethod: String,
    val rows: List<LotSaleRowBody>,
)

/** One share each, by seat id. */
fun evenShares(ran: List<PartyMember>): Map<String, Double> = ran.associateTo(LinkedHashMap()) { it.id to 1.0 }

/** Who ran a row, keyed the same however the seats are ordered. */
fun rosterOf(row: LotRow): LotRoster {
    val names = row.ran.map { it.name }
    return LotRoster(names.sorted().joinToString("\u0000"), names)
}

/** Each distinct roster of more than one seat, first seen first. */
fun lotRosters(rows: List<LotRow>): List<LotRoster> =
    rows.filter { it.ran.size >= 2 }.map(::rosterOf).distinctBy { it.key }

/** The shares typed for a row's roster, by seat id, or even shares where none were typed. */
fun rowShares(
    row: LotRow,
    typed: Map<String, Map<String, Double>>,
): Map<String, Double> {
    val counts = typed[rosterOf(row).key] ?: return evenShares(row.ran)
    return row.ran.associateTo(LinkedHashMap()) { it.id to (counts[it.name] ?: 1.0) }
}

/** The oldest rows that add up to exactly [units], or none and the counts that are reachable. */
fun proposeLot(
    queue: List<LotRow>,
    units: Double,
): LotProposal {
    val rows = mutableListOf<LotRow>()
    var covered = 0.0
    for (row in queue) {
        if (covered + row.units > units) break
        rows += row
        covered += row.units
    }
    if (units >= 1 && covered == units) return LotProposal(rows, covered, emptyList())
    var running = 0.0
    val sums =
        queue.map {
            running += it.units
            running
        }
    return LotProposal(emptyList(), 0.0, sums)
}

/** The reachable counts either side of [asked]. */
fun nearestCounts(
    reachable: List<Double>,
    asked: Double,
): List<Double> = listOfNotNull(reachable.lastOrNull { it < asked }, reachable.firstOrNull { it > asked })

/** Each row's slice of a lot's price, by units, adding up to the price exactly. */
fun priceLot(
    total: Double,
    rows: List<LotRow>,
): List<Double> = largestRemainder(total, rows.map { it.units })

/** What the lot-sale route is sent for a priced lot. */
fun lotSaleBody(
    sale: LotSaleBody,
    lotRows: List<LotRow>,
    typed: Map<String, Map<String, Double>> = emptyMap(),
): LotSaleBody {
    val amounts = priceLot(sale.total, lotRows)
    val rows =
        lotRows.mapIndexed {
                i,
                row,
            ->
            LotSaleRowBody(
                row.partyId,
                row.lootId,
                amounts.getOrElse(i) { 0.0 },
                row.sellerMemberId,
                rowShares(row, typed),
            )
        }
    return sale.copy(rows = rows)
}
