package com.sharpeyes.money.lots

import com.sharpeyes.money.BossDrop
import com.sharpeyes.money.Loot
import com.sharpeyes.money.Party
import com.sharpeyes.money.PartyLootPool
import com.sharpeyes.money.PartyMember
import com.sharpeyes.money.canTrade
import com.sharpeyes.money.compareNumbers
import com.sharpeyes.money.coupons.holderKey
import com.sharpeyes.money.coupons.holderOf
import com.sharpeyes.money.droplog.isPieceDrop
import com.sharpeyes.money.localeCompare
import kotlinx.serialization.Serializable

// What is waiting to be sold, and by whom: the lots of interchangeable drops and the drops that price
// alone. The port of the queue half of frontend/lib/lot-sale.ts.

@Serializable
data class LotRow(
    val lootId: String,
    val partyId: String,
    val units: Double,
    val name: String,
    val iconUrl: String? = null,
    val bossKey: String? = null,
    val droppedOn: String,
    val weekStart: String,
    val characterId: String,
    val sellerMemberId: String,
    val sellerName: String,
    val ran: List<PartyMember>,
    val loggedBy: String? = null,
)

@Serializable
data class LotDrop(
    val dropKey: String,
    val name: String,
    val iconUrl: String? = null,
    val queue: List<LotRow>,
    val units: Double,
)

@Serializable
data class SaleQueues(
    val lots: List<LotDrop>,
    val alone: List<LotRow>,
)

/** Drops any copy of which is any other: a grindstone is a grindstone. In catalog order. */
fun fungibleDropKeys(dropTables: Map<String, List<BossDrop>>): Set<String> =
    dropTables.values
        .flatten()
        .filter { it.fungible }
        .map { it.dropKey }
        .toCollection(LinkedHashSet())

/** One unsold, untaken row [holder] can sell, or null. */
private fun sellableRow(
    pool: PartyLootPool,
    party: Party,
    loot: Loot,
    holder: String,
): LotRow? {
    val ran = party.seats.filter { it.id in loot.ranThatWeek }
    val seller = ran.find { holderKey(holderOf(it)) == holder } ?: return null
    return LotRow(
        lootId = loot.id,
        partyId = pool.partyId,
        units = loot.quantity,
        name = loot.name,
        iconUrl = loot.iconUrl,
        bossKey = loot.bossKey,
        droppedOn = loot.droppedOn,
        weekStart = loot.weekStart,
        characterId = party.characterId,
        sellerMemberId = seller.id,
        sellerName = seller.name,
        ran = ran,
        loggedBy = if (loot.recordedByYou == false) loot.recordedByName else null,
    )
}

/** Every row of a tradeable pool [holder] could sell and [wanted] admits, oldest first. */
private fun sellableRows(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    holder: String,
    wanted: (Loot, Party) -> Boolean,
): List<LotRow> {
    val partyById = parties.associateBy { it.id }
    val rows =
        pools.flatMap { pool ->
            val party = partyById[pool.partyId]?.takeIf { canTrade(it.worldType) }
            val open = { loot: Loot -> loot.soldAt == null && loot.takenByMemberId == null && loot.quantity >= 1 }
            party?.let { p ->
                pool.loot.filter { open(it) && wanted(it, p) }.mapNotNull { sellableRow(pool, p, it, holder) }
            }
                ?: emptyList()
        }
    return rows.sortedWith { a, b ->
        localeCompare(a.droppedOn, b.droppedOn).takeIf { it != 0 }
            ?: localeCompare(a.lootId, b.lootId)
    }
}

fun lotQueue(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropKey: String,
    holder: String,
): List<LotRow> = sellableRows(parties, pools, holder) { loot, _ -> loot.dropKey == dropKey }

/** One lot per interchangeable drop with anything to sell, the biggest first. */
fun lotDrops(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    fungible: Set<String>,
    holder: String,
): List<LotDrop> {
    val lots =
        fungible.mapNotNull { dropKey ->
            val queue = lotQueue(parties, pools, dropKey, holder)
            queue.firstOrNull()?.let {
                LotDrop(
                    dropKey,
                    it.name,
                    it.iconUrl,
                    queue,
                    queue.fold(0.0) { sum, r ->
                        sum +
                            r.units
                    },
                )
            }
        }
    return lots.sortedWith { a, b ->
        compareNumbers(b.units - a.units).takeIf { it != 0 }
            ?: localeCompare(a.name, b.name)
    }
}

/** The drops that price alone: neither interchangeable nor in pieces. */
fun rowSales(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropTables: Map<String, List<BossDrop>>,
    fungible: Set<String>,
    holder: String,
): List<LotRow> =
    sellableRows(parties, pools, holder) { loot, party ->
        (loot.dropKey ?: "") !in fungible && !isPieceDrop(loot, party, dropTables)
    }

fun saleQueues(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropTables: Map<String, List<BossDrop>>,
    holder: String,
): SaleQueues {
    val fungible = fungibleDropKeys(dropTables)
    return SaleQueues(
        lotDrops(parties, pools, fungible, holder),
        rowSales(parties, pools, dropTables, fungible, holder),
    )
}
