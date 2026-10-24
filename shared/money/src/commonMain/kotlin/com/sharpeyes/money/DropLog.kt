package com.sharpeyes.money

import kotlinx.serialization.Serializable

// Every drop your parties have logged, as a history with money attached. The port of buildDropLog and
// its readers in frontend/lib/drop-log.ts. Not a second splitter: every meso is splitOf's. Grouping,
// folding and labels stay with the client, which sums and names what this serves.

@Serializable
data class DropEntry(
    val lootId: String,
    val partyId: String,
    val characterId: String,
    val name: String,
    val dropKey: String? = null,
    val iconUrl: String? = null,
    val quantity: Double,
    val pieces: Boolean,
    val yours: Double,
    val owedBy: String? = null,
    val owedTo: String? = null,
    val owedToYou: Double,
    val owedByYou: Double,
    val closed: Boolean,
    val bossKey: String? = null,
    val droppedOn: String,
    val recordedAt: String? = null,
    val weekStart: String,
    val perMember: String? = null,
    val status: String,
    val soldAt: String? = null,
    val saleAmount: Double? = null,
    val currency: String,
    val amountBasis: String? = null,
    val splitMethod: String? = null,
    val takenByName: String? = null,
    val ranWith: List<String>,
    val sellerName: String? = null,
    val pooled: Double? = null,
    val yourTake: Double? = null,
    val unreadable: Boolean,
    val unpaidYours: Double,
    val unpaidOthers: Double,
)

@Serializable
data class Pooled(
    val pooled: Double,
    val yourTake: Double,
)

@Serializable
data class DropLogTotals(
    val drops: Double,
    val sold: Double,
    val taken: Double,
    val pending: Double,
    val pooled: Double,
    val yourTake: Double,
    val usd: Pooled,
    val unreadable: Double,
)

@Serializable
data class DropLog(
    val entries: List<DropEntry>,
    val totals: DropLogTotals,
)

@Serializable
data class CouponsOutstanding(
    val toYou: Double,
)

private fun catalogDrop(
    loot: Loot,
    dropTables: Map<String, List<BossDrop>>,
): BossDrop? = loot.dropKey?.let { key -> dropTables[loot.bossKey ?: ""]?.find { it.dropKey == key } }

/** Whether a drop arrives in pieces that one seat may hold for others. */
fun isPieceDrop(
    loot: Loot,
    party: Party,
    dropTables: Map<String, List<BossDrop>>,
): Boolean {
    val fellAt = loot.difficulty ?: party.difficulty
    val drop = catalogDrop(loot, dropTables)
    val pieces = fellAt?.let { drop?.pieces?.get(party.worldType)?.get(it) } ?: 0.0
    return fellAt != null && !isPerMember(drop?.perMember, party.worldType) && pieces > 0
}

fun isCouponDrop(
    loot: Loot,
    party: Party,
    dropTables: Map<String, List<BossDrop>>,
): Boolean = canTrade(party.worldType) && isPieceDrop(loot, party, dropTables)

/** What one sale left in your hands: the seller's keep if the seller is yours, plus what your seats net. */
private fun takeFor(
    loot: Loot,
    members: List<PartyMember>,
): Double? {
    val split = splitOf(loot, members) ?: return null
    val byId = members.associateBy { it.id }
    val seller = byId[split.seller.memberId]
    val kept = if (seller != null && isMine(seller)) split.seller.keeps else 0.0
    val owed = split.shares.filter { byId[it.memberId]?.let(::isMine) == true }.fold(0.0) { sum, s -> sum + s.nets }
    return kept + owed
}

/** One loot row as the log reads it. */
private class EntryReader(
    private val party: Party,
    private val dropTables: Map<String, List<BossDrop>>,
    private val closed: Set<String>,
) {
    private fun seatMine(id: String?): Boolean = id != null && party.seats.find { it.id == id }?.let(::isMine) == true

    fun read(
        pool: PartyLootPool,
        loot: Loot,
    ): DropEntry {
        val sold = loot.soldAt != null
        val split = if (sold) splitOf(loot, party.seats) else null
        val priced = saleMoney(loot)
        val sellerMine = seatMine(loot.sellerMemberId)
        val unpaid = loot.payouts.filterNot { it.paid }
        val unpaidYours = unpaid.count { sellerMine || seatMine(it.memberId) }
        val pieces = isPieceDrop(loot, party, dropTables)
        val gap = if (isCouponDrop(loot, party, dropTables)) couponGapOf(loot, party) else null
        val ranWith = ranSeats(loot, party).filterNot(::isMine).map { it.name }
        return DropEntry(
            lootId = loot.id,
            partyId = pool.partyId,
            characterId = party.characterId,
            name = loot.name,
            dropKey = loot.dropKey,
            iconUrl = loot.iconUrl,
            quantity = loot.quantity,
            pieces = pieces,
            yours = if (pieces) yourShare(loot.quantity, ranSeats(loot, party)) else loot.quantity,
            owedBy = gap?.takeIf { !it.yours }?.by,
            owedTo = gap?.takeIf { it.yours }?.by,
            owedToYou = gap?.takeIf { !it.yours }?.pieces ?: 0.0,
            owedByYou = gap?.takeIf { it.yours }?.pieces ?: 0.0,
            closed = gap != null && closureKeyOf(gap.holder, loot.id) in closed,
            bossKey = loot.bossKey,
            droppedOn = loot.droppedOn,
            recordedAt = loot.recordedAt,
            weekStart = loot.weekStart,
            perMember = loot.perMember,
            status = loot.status,
            soldAt = loot.soldAt,
            saleAmount = priced?.amount,
            currency = priced?.currency ?: "MESO",
            amountBasis = loot.amountBasis,
            splitMethod = loot.splitMethod,
            takenByName = party.seats.find { it.id == loot.takenByMemberId }?.name,
            ranWith = ranWith,
            sellerName = split?.seller?.name,
            pooled = split?.split?.sellerReceives?.toDouble(),
            yourTake = split?.let { takeFor(loot, party.seats) },
            unreadable = sold && split == null,
            unpaidYours = unpaidYours.toDouble(),
            unpaidOthers = (unpaid.size - unpaidYours).toDouble(),
        )
    }
}

/** Every drop in [pools], newest first. [closed] is the closure keys a coupon gap reads as settled. */
fun buildDropLog(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropTables: Map<String, List<BossDrop>>,
    closed: Set<String> = emptySet(),
): DropLog {
    val partyById = parties.associateBy { it.id }
    val entries =
        pools.flatMap { pool ->
            val party = partyById[pool.partyId]
            if (party == null) emptyList() else pool.loot.map { EntryReader(party, dropTables, closed).read(pool, it) }
        }
    val sorted =
        entries.sortedWith { a, b ->
            localeCompare(b.droppedOn, a.droppedOn).takeIf { it != 0 }
                ?: localeCompare(a.lootId, b.lootId)
        }
    return DropLog(sorted, totalsOf(sorted))
}

/** A drop with nothing left for you to do: taken, or sold with every share through your seats paid. */
fun settledForYou(entry: DropEntry): Boolean =
    !entry.pieces && (entry.status == "TAKEN" || (entry.soldAt != null && entry.unpaidYours == 0.0))

/** In the pool and not a piece drop: still waiting to be sold or taken. */
fun isOutstanding(entry: DropEntry): Boolean = entry.status == "PENDING" && !entry.pieces

private fun sumIn(
    entries: List<DropEntry>,
    currency: String,
    of: (DropEntry) -> Double?,
): Double = entries.fold(0.0) { sum, e -> sum + if (e.currency == currency) of(e) ?: 0.0 else 0.0 }

fun totalsOf(entries: List<DropEntry>): DropLogTotals =
    DropLogTotals(
        drops = entries.size.toDouble(),
        sold = entries.count { it.status == "SOLD" || it.status == "PAID_OUT" }.toDouble(),
        taken = entries.count { it.status == "TAKEN" }.toDouble(),
        pending = entries.count(::isOutstanding).toDouble(),
        pooled = sumIn(entries, "MESO") { it.pooled },
        yourTake = sumIn(entries, "MESO") { it.yourTake },
        usd = Pooled(sumIn(entries, "USD") { it.pooled }, sumIn(entries, "USD") { it.yourTake }),
        unreadable = entries.count { it.unreadable }.toDouble(),
    )

/** Coupons still owed to you, per party, from [weekStart] on when given. */
fun couponsOutstandingByParty(
    entries: List<DropEntry>,
    weekStart: String? = null,
): Map<String, CouponsOutstanding> {
    val out = LinkedHashMap<String, Double>()
    val counted =
        entries.filter {
            (weekStart == null || it.weekStart >= weekStart) &&
                it.pieces &&
                !it.closed &&
                it.owedToYou != 0.0
        }
    for (entry in counted) out[entry.partyId] = (out[entry.partyId] ?: 0.0) + entry.owedToYou
    return out.mapValuesTo(LinkedHashMap()) { (_, toYou) -> CouponsOutstanding(toYou) }
}
