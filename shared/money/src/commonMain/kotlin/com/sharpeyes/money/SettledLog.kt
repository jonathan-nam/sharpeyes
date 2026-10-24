package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.floor

// What is finished, and how it got that way: the last stage of the Drop Log's pipeline, a record
// rather than a worklist. The port of frontend/lib/settled-log.ts.

@Serializable
data class SettledSale(
    val amount: Double,
    val currency: String,
    val basis: String? = null,
    val pooled: Double? = null,
    val yourTake: Double? = null,
    val seller: String? = null,
)

@Serializable
data class SettledRecord(
    val key: String,
    val lootId: String,
    val partyId: String,
    val characterId: String,
    val name: String,
    val iconUrl: String? = null,
    val bossKey: String? = null,
    val droppedOn: String,
    val weekStart: String,
    val quantity: Double,
    /** MONEY or PIECES. */
    val kind: String,
    val settledOn: String? = null,
    val sale: SettledSale? = null,
    val takenBy: String? = null,
    val holderName: String? = null,
    val pieces: Double,
    val writtenOff: Double,
    val settlementId: String? = null,
)

@Serializable
data class SettledLine(
    val key: String,
    val records: List<SettledRecord>,
    val folded: Boolean,
    val pieces: Double,
    val writtenOff: Double,
)

@Serializable
data class SettledTotals(
    val nights: Double,
    val sales: Double,
    val taken: Double,
    val pooled: Double,
    val yourTake: Double,
    val writtenOff: Double,
    val unreadable: Double,
    val usd: Pooled,
)

/** One act's write-off over the drops it closed, the remainder on the first. */
internal fun shareOfWriteOff(
    unpaid: Double,
    drops: Int,
    index: Int,
): Double {
    if (drops < 1 || unpaid < 1) return 0.0
    val each = floor(unpaid / drops)
    return if (index == 0) each + (unpaid - each * drops) else each
}

private fun moneyRecord(entry: DropEntry): SettledRecord {
    val taken = entry.status == "TAKEN"
    val sale =
        entry.saleAmount?.takeIf { !taken }?.let {
            SettledSale(it, entry.currency, entry.amountBasis, entry.pooled, entry.yourTake, entry.sellerName)
        }
    return SettledRecord(
        key = "loot:${entry.lootId}",
        lootId = entry.lootId,
        partyId = entry.partyId,
        characterId = entry.characterId,
        name = entry.name,
        iconUrl = entry.iconUrl,
        bossKey = entry.bossKey,
        droppedOn = entry.droppedOn,
        weekStart = entry.weekStart,
        quantity = entry.quantity,
        kind = "MONEY",
        settledOn = if (taken) null else entry.soldAt,
        sale = sale,
        takenBy = if (taken) entry.takenByName else null,
        pieces = 0.0,
        writtenOff = 0.0,
    )
}

/** The records one closure wrote: one per drop it closed, in id order, the write-off spread over them. */
private fun closureRecords(
    act: VestigeSettlement,
    byLoot: Map<String, DropEntry>,
    names: Map<String, String>,
): List<SettledRecord> {
    val key = holderKey(act.holder)
    val closed = act.lootIds.sorted()
    return closed.mapIndexedNotNull { i, lootId ->
        byLoot[lootId]?.let { entry ->
            SettledRecord(
                key = "settlement:${act.id}:$lootId",
                lootId = lootId,
                partyId = entry.partyId,
                characterId = entry.characterId,
                name = entry.name,
                iconUrl = entry.iconUrl,
                bossKey = entry.bossKey,
                droppedOn = entry.droppedOn,
                weekStart = entry.weekStart,
                quantity = entry.quantity,
                kind = "PIECES",
                settledOn = act.settledAt,
                holderName = names[key] ?: key,
                pieces = if (entry.owedToYou > 0) entry.owedToYou else entry.owedByYou,
                writtenOff = shareOfWriteOff(act.unpaid, closed.size, i),
                settlementId = act.id,
            )
        }
    }
}

/** Every finished drop and closed night, newest settled first. */
fun buildSettledLog(
    entries: List<DropEntry>,
    settlements: List<VestigeSettlement> = emptyList(),
    names: Map<String, String> = emptyMap(),
): List<SettledRecord> {
    val byLoot = entries.associateBy { it.lootId }
    val money = entries.filter { !it.pieces && settledForYou(it) }.map(::moneyRecord)
    val pieces = settlements.flatMap { closureRecords(it, byLoot, names) }
    return (money + pieces).sortedWith { a, b ->
        localeCompare(b.settledOn ?: b.droppedOn, a.settledOn ?: a.droppedOn).takeIf { it != 0 }
            ?: localeCompare(b.droppedOn, a.droppedOn).takeIf { it != 0 }
            ?: localeCompare(a.key, b.key)
    }
}

/** Drops closures name that the log no longer has. */
fun orphansOf(
    entries: List<DropEntry>,
    settlements: List<VestigeSettlement>,
): Double {
    val known = entries.map { it.lootId }.toSet()
    return settlements.fold(0.0) { sum, act -> sum + act.lootIds.count { it !in known } }
}

/** The records of one closure folded into one line, the rest one line each. */
fun consolidateSettled(rows: List<SettledRecord>): List<SettledLine> {
    val at = HashMap<String, Int>()
    val out = mutableListOf<SettledLine>()
    for (row in rows) {
        val act = row.settlementId
        val seen = act?.let { at[it] }
        when {
            act == null -> out += SettledLine(row.key, listOf(row), false, 0.0, 0.0)
            seen == null -> {
                at[act] = out.size
                out += SettledLine("settlement:$act", listOf(row), false, row.pieces, row.writtenOff)
            }
            else -> {
                val line = out[seen]
                val writtenOff = line.writtenOff + row.writtenOff
                out[seen] =
                    line.copy(
                        records = line.records + row,
                        folded = true,
                        pieces = line.pieces + row.pieces,
                        writtenOff = writtenOff,
                    )
            }
        }
    }
    return out
}

private fun saleIn(
    row: SettledRecord,
    currency: String,
    of: (SettledSale) -> Double?,
): Double = row.sale?.takeIf { it.currency == currency }?.let(of) ?: 0.0

/** What the settled record comes to, the coupon lots included. */
fun settledTotals(
    rows: List<SettledRecord>,
    coupons: CouponMoney = CouponMoney(0.0, 0.0),
): SettledTotals {
    val usdPooled = rows.fold(0.0) { sum, r -> sum + saleIn(r, "USD") { it.pooled } }
    val usdTake = rows.fold(0.0) { sum, r -> sum + saleIn(r, "USD") { it.yourTake } }
    return SettledTotals(
        nights = rows.count { it.kind == "PIECES" }.toDouble(),
        sales = rows.count { it.kind == "MONEY" && it.takenBy == null }.toDouble(),
        taken = rows.count { it.takenBy != null }.toDouble(),
        pooled = rows.fold(coupons.pooled) { sum, r -> sum + saleIn(r, "MESO") { it.pooled } },
        yourTake = rows.fold(coupons.yourTake) { sum, r -> sum + saleIn(r, "MESO") { it.yourTake } },
        writtenOff = rows.fold(0.0) { sum, r -> sum + r.writtenOff },
        unreadable = rows.count { it.sale != null && it.sale.pooled == null }.toDouble(),
        usd = Pooled(usdPooled, usdTake),
    )
}
