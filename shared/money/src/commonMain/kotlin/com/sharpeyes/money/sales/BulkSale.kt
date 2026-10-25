package com.sharpeyes.money.sales

import com.sharpeyes.money.PartyMember
import com.sharpeyes.money.pieces.largestRemainder
import kotlinx.serialization.Serializable

// Selling a pile of one interchangeable drop in one go: which rows a count covers, and what each row's
// slice of the price is. The port of the pricing half of frontend/lib/bulk-sale.ts.

@Serializable
data class BulkRoster(
    val key: String,
    val names: List<String>,
)

@Serializable
data class BulkProposal(
    val rows: List<SaleRow>,
    val units: Double,
    val reachable: List<Double>,
)

@Serializable
data class BulkSaleRowBody(
    val partyId: String,
    val lootId: String,
    val amount: Double,
    val sellerMemberId: String,
    val shares: Map<String, Double>,
)

@Serializable
data class BulkSaleBody(
    val dropKey: String,
    val total: Double,
    val amountBasis: String,
    val splitMethod: String,
    val rows: List<BulkSaleRowBody>,
)

/** One share each, by seat id. */
fun evenShares(ran: List<PartyMember>): Map<String, Double> = ran.associateTo(LinkedHashMap()) { it.id to 1.0 }

/** Who ran a row, keyed the same however the seats are ordered. */
fun rosterOf(row: SaleRow): BulkRoster {
    val names = row.ran.map { it.name }
    return BulkRoster(names.sorted().joinToString("\u0000"), names)
}

/** Each distinct roster of more than one seat, first seen first. */
fun bulkRosters(rows: List<SaleRow>): List<BulkRoster> =
    rows.filter { it.ran.size >= 2 }.map(::rosterOf).distinctBy { it.key }

/** The shares typed for a row's roster, by seat id, or even shares where none were typed. */
fun rowShares(
    row: SaleRow,
    typed: Map<String, Map<String, Double>>,
): Map<String, Double> {
    val counts = typed[rosterOf(row).key] ?: return evenShares(row.ran)
    return row.ran.associateTo(LinkedHashMap()) { it.id to (counts[it.name] ?: 1.0) }
}

/** The oldest rows that add up to exactly [units], or none and the counts that are reachable. */
fun proposeBulkSale(
    queue: List<SaleRow>,
    units: Double,
): BulkProposal {
    val rows = mutableListOf<SaleRow>()
    var covered = 0.0
    for (row in queue) {
        if (covered + row.units > units) break
        rows += row
        covered += row.units
    }
    if (units >= 1 && covered == units) return BulkProposal(rows, covered, emptyList())
    var running = 0.0
    val sums =
        queue.map {
            running += it.units
            running
        }
    return BulkProposal(emptyList(), 0.0, sums)
}

/** The reachable counts either side of [asked]. */
fun nearestCounts(
    reachable: List<Double>,
    asked: Double,
): List<Double> = listOfNotNull(reachable.lastOrNull { it < asked }, reachable.firstOrNull { it > asked })

/** Each row's slice of a bulk sale's price, by units, adding up to the price exactly. */
fun priceBulkSale(
    total: Double,
    rows: List<SaleRow>,
): List<Double> = largestRemainder(total, rows.map { it.units })

/** What the bulk-sale route is sent for a priced bulk sale. */
fun bulkSaleBody(
    sale: BulkSaleBody,
    bulkRows: List<SaleRow>,
    typed: Map<String, Map<String, Double>> = emptyMap(),
): BulkSaleBody {
    val amounts = priceBulkSale(sale.total, bulkRows)
    val rows =
        bulkRows.mapIndexed {
                i,
                row,
            ->
            BulkSaleRowBody(
                row.partyId,
                row.lootId,
                amounts.getOrElse(i) { 0.0 },
                row.sellerMemberId,
                rowShares(row, typed),
            )
        }
    return sale.copy(rows = rows)
}
