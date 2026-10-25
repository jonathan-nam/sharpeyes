package com.sharpeyes.money.coupons

import com.sharpeyes.money.Holder
import com.sharpeyes.money.Loot
import com.sharpeyes.money.Party
import com.sharpeyes.money.PartyLootPool
import com.sharpeyes.money.TaggedMapSerializer
import com.sharpeyes.money.TaggedSetSerializer
import com.sharpeyes.money.compareNumbers
import com.sharpeyes.money.localeCompare
import com.sharpeyes.money.pieces.AnsweredSale
import com.sharpeyes.money.pieces.BoughtPieces
import com.sharpeyes.money.pieces.LedgerDrop
import com.sharpeyes.money.pieces.LedgerSeat
import com.sharpeyes.money.pieces.PieceTransfer
import com.sharpeyes.money.pieces.balances
import com.sharpeyes.money.pieces.heldOf
import com.sharpeyes.money.pieces.ownShareOf
import com.sharpeyes.money.pieces.transfersOf
import kotlinx.serialization.Serializable

// Every coupon night that still owes somebody, and one ledger per holder of the piles they sit in. The
// port of outstanding, alsoHeldByYou and holderLedgers in frontend/lib/vestige-ledger.ts.

/** One boss's outstanding pieces in one holder's pile. */
@Serializable
data class OutstandingDrop(
    val drop: LedgerDrop,
    val lootId: String,
    val partyId: String,
    val bossKey: String? = null,
    val droppedOn: String,
    val recordedAt: String? = null,
    val holder: Holder,
    val holderName: String,
    val looterName: String,
    val ran: List<String>,
)

/** One drop in a holder's ledger. */
@Serializable
data class LedgerEntry(
    val lootId: String,
    val partyId: String,
    val bossKey: String? = null,
    val weekStart: String,
    val droppedOn: String,
    val recordedAt: String? = null,
    val looterName: String,
    val ran: List<String>,
    val pieces: Double,
    val closed: Boolean,
    val transfers: List<PieceTransfer>,
)

/** One holder's pile across every boss still open. See HolderLedger in vestige-ledger.ts. */
@Serializable
data class HolderLedger(
    val holder: Holder,
    val holderName: String,
    val pieces: Double,
    val owedToYou: Double,
    val received: Double,
    val kept: Double,
    val ownShare: Double,
    val bought: BoughtPieces,
    val soldPieces: Double,
    val answered: Double,
    @Serializable(with = TaggedMapSerializer::class)
    val answeredByCreditor: Map<String, List<AnsweredSale>>,
    val closed: Boolean,
    val writtenOff: Double,
    val accounted: Double,
    val drops: List<LedgerEntry>,
)

/** Which (holder, drop) pairs are closed, and what each holder's acts wrote off. */
@Serializable
data class Closures(
    @Serializable(with = TaggedSetSerializer::class)
    val closed: Set<String> = emptySet(),
    @Serializable(with = TaggedMapSerializer::class)
    val writtenOff: Map<String, Double> = emptyMap(),
)

/** JavaScript's Number.MAX_SAFE_INTEGER, which is where a boss missing from the catalog sorts. */
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0

/** The catalog order of a boss, or last for one missing from it. */
private fun orderOf(
    bossOrder: Map<String, Double>,
    loot: Loot,
): Double = bossOrder[loot.bossKey ?: ""] ?: MAX_SAFE_INTEGER

/** Every drop that still owes somebody: one row per holder holding pieces of it. */
fun outstanding(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropKey: String,
    bossOrder: Map<String, Double>,
): List<OutstandingDrop> {
    val partyById = parties.associateBy { it.id }
    return pools.flatMap { pool ->
        val party = partyById[pool.partyId]
        if (party == null) {
            emptyList()
        } else {
            pool.loot.filter { it.dropKey == dropKey && it.quantity >= 1 }.flatMap {
                owingPiles(
                    pool,
                    party,
                    it,
                    bossOrder,
                )
            }
        }
    }
}

/** The piles of one drop that owe or are owed, or none when everybody landed on their share. */
private fun owingPiles(
    pool: PartyLootPool,
    party: Party,
    loot: Loot,
    bossOrder: Map<String, Double>,
): List<OutstandingDrop> {
    val holders = holdersOf(loot, party)
    val held = holders.takeIf { it.size >= 2 }?.let { heldByHolder(loot, party, it) }
    val seats =
        held?.let { piles ->
            holders.map { LedgerSeat(it.key, it.name, piles[it.key]?.pieces ?: 0.0, it.shares) }
        }
    // Everybody exactly on their share is nothing to settle and no pile to queue.
    val owes = seats != null && !balances(loot.quantity, seats).all { it.balance == 0.0 }
    if (!owes) return emptyList()
    val byKey = holders.associateBy { it.key }
    val night = NightRows(pool, loot, orderOf(bossOrder, loot), seats!!, ranSeats(loot, party).map { it.name })
    return held!!.mapNotNull { (key, pile) -> byKey[key]?.takeIf { pile.pieces > 0 }?.let { night.row(it, pile) } }
}

/** What every pile row of one night shares. */
private class NightRows(
    val pool: PartyLootPool,
    val loot: Loot,
    val order: Double,
    val seats: List<LedgerSeat>,
    val ran: List<String>,
) {
    fun row(
        holder: FoldedSeat,
        pile: Pile,
    ): OutstandingDrop {
        val drop = LedgerDrop(loot.id, loot.weekStart, order, loot.quantity, seats, held = pile.pieces)
        return OutstandingDrop(
            drop = drop,
            lootId = loot.id,
            partyId = pool.partyId,
            bossKey = loot.bossKey,
            droppedOn = loot.droppedOn,
            recordedAt = loot.recordedAt,
            holder = holder.holder,
            holderName = holder.name,
            looterName = pile.by,
            ran = ran,
        )
    }
}

/** The coupons of yours that `outstanding` leaves out: nights nobody owes anything on. */
fun alsoHeldByYou(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropKey: String,
    bossOrder: Map<String, Double>,
    queued: List<OutstandingDrop>,
): List<OutstandingDrop> {
    val already = queued.filter { holderKey(it.holder) == SELF_KEY }.map { it.lootId }.toSet()
    val partyById = parties.associateBy { it.id }
    return pools.flatMap { pool ->
        val party = partyById[pool.partyId]
        if (party == null) {
            emptyList()
        } else {
            pool.loot
                .filter { it.dropKey == dropKey && it.quantity >= 1 && it.id !in already }
                .mapNotNull { yourPile(pool, party, it, bossOrder) }
        }
    }
}

private fun yourPile(
    pool: PartyLootPool,
    party: Party,
    loot: Loot,
    bossOrder: Map<String, Double>,
): OutstandingDrop? {
    val ran = ranSeats(loot, party)
    val holders = foldSeats(ran)
    val mine = holders.find { it.key == SELF_KEY }
    val held =
        when {
            mine == null -> null
            // Nobody else was there, so every piece that fell is yours.
            holders.size == 1 -> mapOf(SELF_KEY to Pile(loot.quantity, ran.firstOrNull()?.name ?: mine.name))
            else -> heldByHolder(loot, party, holders)
        }
    val pile = held?.get(SELF_KEY)?.takeIf { it.pieces > 0 }
    if (mine == null || pile == null) return null
    val seats = holders.map { LedgerSeat(it.key, it.name, held[it.key]?.pieces ?: 0.0, it.shares) }
    return NightRows(pool, loot, orderOf(bossOrder, loot), seats, ran.map { it.name }).row(mine, pile)
}

/** What holderLedgers reads besides the drops. Each absent is none, as in the TypeScript. */
data class LedgerInputs(
    val salesByHolder: Map<String, Double>,
    val keptByHolder: Map<String, Double> = emptyMap(),
    val boughtByHolder: Map<String, BoughtPieces> = emptyMap(),
    val receivedByHolder: Map<String, Double> = emptyMap(),
    val closures: Closures = Closures(),
    val answeredByHolder: Map<String, Double> = emptyMap(),
    val answeredByPair: Map<String, List<AnsweredSale>> = emptyMap(),
)

/** One ledger per holder. Open piles first, then by name. */
fun holderLedgers(
    drops: List<OutstandingDrop>,
    inputs: LedgerInputs,
): List<HolderLedger> {
    val byHolder = LinkedHashMap<String, MutableList<OutstandingDrop>>()
    for (d in drops) byHolder.getOrPut(holderKey(d.holder)) { mutableListOf() } += d
    return byHolder
        .map { (key, mine) -> ledgerOf(key, mine, inputs) }
        .sortedWith { a, b ->
            a.closed.compareTo(b.closed).takeIf { it != 0 }
                ?: localeCompare(a.holderName, b.holderName)
        }
}

private fun ledgerOf(
    key: String,
    mine: List<OutstandingDrop>,
    inputs: LedgerInputs,
): HolderLedger {
    val kept = inputs.keptByHolder[key] ?: 0.0
    val bought = inputs.boughtByHolder[key] ?: BoughtPieces(0.0, 0.0)
    val soldPieces = inputs.salesByHolder[key] ?: 0.0
    val drops = mine.sortedWith(::oldestBossFirst).map { entryOf(it, key, inputs.closures) }
    val owedToYou =
        drops
            .filterNot { it.closed }
            .flatMap { it.transfers }
            .filter { it.toId == SELF_KEY }
            .fold(0.0) { sum, t -> sum + t.pieces }
    // Only the creditors this pile's own nights name.
    val answeredByCreditor = LinkedHashMap<String, List<AnsweredSale>>()
    for (creditor in drops.flatMap { d -> d.transfers.map { it.toId } }.distinct()) {
        answeredByCreditor[creditor] = inputs.answeredByPair[answeredKey(key, creditor)] ?: emptyList()
    }
    return HolderLedger(
        holder = mine.first().holder,
        holderName = mine.first().holderName,
        pieces = drops.fold(0.0) { sum, d -> sum + d.pieces },
        owedToYou = owedToYou,
        received = inputs.receivedByHolder[key] ?: 0.0,
        kept = kept,
        ownShare = mine.fold(0.0) { sum, d -> sum + ownShareOf(d.drop, key) },
        bought = bought,
        soldPieces = soldPieces,
        answered = inputs.answeredByHolder[key] ?: 0.0,
        answeredByCreditor = answeredByCreditor,
        closed = drops.isNotEmpty() && drops.all { it.closed },
        writtenOff = inputs.closures.writtenOff[key] ?: 0.0,
        accounted = soldPieces + kept + bought.pieces,
        drops = drops,
    )
}

/** Oldest week first, then the catalog's order, then the drop's id. */
private fun oldestBossFirst(
    a: OutstandingDrop,
    b: OutstandingDrop,
): Int =
    localeCompare(a.drop.weekStart, b.drop.weekStart).takeIf { it != 0 }
        ?: compareNumbers(a.drop.order - b.drop.order).takeIf { it != 0 }
        ?: localeCompare(a.drop.id, b.drop.id)

private fun entryOf(
    d: OutstandingDrop,
    key: String,
    closures: Closures,
): LedgerEntry =
    LedgerEntry(
        lootId = d.lootId,
        partyId = d.partyId,
        bossKey = d.bossKey,
        weekStart = d.drop.weekStart,
        droppedOn = d.droppedOn,
        recordedAt = d.recordedAt,
        looterName = d.looterName,
        ran = d.ran,
        pieces = heldOf(d.drop),
        closed = closureKey(d.holder, d.lootId) in closures.closed,
        transfers = transfersOf(d.drop, key),
    )
