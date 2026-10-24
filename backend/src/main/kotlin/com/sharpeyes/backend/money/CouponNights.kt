package com.sharpeyes.backend.money

import kotlinx.serialization.Serializable
import kotlin.math.abs

// One night's coupons: who walked away with what, and what that leaves owed. The port of the night half
// of frontend/lib/vestige-ledger.ts. A night that did not divide and that nobody has answered for is
// never guessed at: it is `unanswered`, which names the size of the hole without its direction.

/** One holder's pieces from one drop, and which of their characters bent down for them. */
internal data class Pile(
    val pieces: Double,
    val by: String,
)

@Serializable
data class CouponGap(
    val pieces: Double,
    /** True when YOU are holding them, so they are yours to hand over. */
    val yours: Boolean,
    val by: String,
    val holder: String,
    val byKey: String,
)

@Serializable
data class UnansweredDrop(
    val lootId: String,
    val partyId: String,
    val bossKey: String? = null,
    val weekStart: String,
    val quantity: Double,
    val bundles: Double,
    val seats: List<PartyMember>,
    val imbalance: Double,
)

/** How many stacks a drop fell in. Absent and null are the same answer. */
internal fun bundlesOf(loot: Loot): Double? = loot.bundles

/** The seats that ran, folded to holders. Empty when there is nothing to divide. */
internal fun holdersOf(
    loot: Loot,
    party: Party,
): List<FoldedSeat> {
    val ran = ranSeats(loot, party)
    return if (ran.size < 2) emptyList() else foldSeats(ran)
}

/** What each holder walked away with, the empty-handed included, or null when nobody has said. */
internal fun heldByHolder(
    loot: Loot,
    party: Party,
    holders: List<FoldedSeat>,
): Map<String, Pile>? {
    val held = pilesFrom(loot, party, holders) ?: return null
    for (holder in holders) held.putIfAbsent(holder.key, Pile(0.0, holder.name))
    return held
}

/** A recorded arrangement, stack by stack, or an even division where the stacks divide. */
private fun pilesFrom(
    loot: Loot,
    party: Party,
    holders: List<FoldedSeat>,
): LinkedHashMap<String, Pile>? {
    val bundles = bundlesOf(loot)
    val bundlesBy = loot.bundlesBy ?: emptyList()
    return when {
        bundlesBy.isNotEmpty() && bundles != null && bundles > 0 -> arranged(loot, party, bundles, bundlesBy)
        bundles != null && dividesEvenly(bundles, holders) -> {
            val weight = holders.fold(0.0) { sum, h -> sum + h.shares }
            LinkedHashMap<String, Pile>().apply {
                holders.forEach { put(it.key, Pile((loot.quantity * it.shares) / weight, it.name)) }
            }
        }
        else -> null
    }
}

/** The arrangement as recorded, folded to holders. Null when it names a seat the party does not have. */
private fun arranged(
    loot: Loot,
    party: Party,
    bundles: Double,
    bundlesBy: List<LootBundle>,
): LinkedHashMap<String, Pile>? {
    val size = loot.quantity / bundles
    val seat = party.seats.associateBy { it.id }
    val held = LinkedHashMap<String, Pile>()
    for (row in bundlesBy) {
        val picked = seat[row.memberId] ?: return null
        val key = holderKey(holderOf(picked))
        val seen = held[key]
        held[key] =
            if (seen == null) {
                Pile(row.bundles * size, picked.name)
            } else {
                // One person can bend down twice. Both characters are named.
                val by = if (seen.by.contains(picked.name)) seen.by else "${seen.by}, ${picked.name}"
                Pile(seen.pieces + row.bundles * size, by)
            }
    }
    return held
}

/** One night's coupon debt, whichever way it runs, or null where nothing is owed or nobody has said. */
fun couponGapOf(
    loot: Loot,
    party: Party,
): CouponGap? {
    val ran = ranSeats(loot, party)
    val holders = if (ran.size < 2) emptyList() else foldSeats(ran)
    val held = holders.takeIf { it.isNotEmpty() }?.let { heldByHolder(loot, party, it) }
    val short = held?.let { pieces(yourShare(loot.quantity, ran) - (it[SELF_KEY]?.pieces ?: 0.0)) } ?: 0.0
    val them = if (held == null || short == 0.0) null else otherSide(loot, holders, held, short)
    return them?.let {
        val by = held!![it.key]?.by ?: it.name
        if (short > 0) CouponGap(short, false, by, it.key, it.key) else CouponGap(-short, true, by, SELF_KEY, it.key)
    }
}

/** Whoever is furthest from their own share, opposite to yours: the other side of a gap. */
private fun otherSide(
    loot: Loot,
    holders: List<FoldedSeat>,
    held: Map<String, Pile>,
    short: Double,
): FoldedSeat? {
    val entitled = entitlements(loot.quantity, holders.map { LedgerSeat(it.key, it.name, 0.0, it.shares) })
    return holders
        .filter { it.key != SELF_KEY }
        .map { it to (held[it.key]?.pieces ?: 0.0) - (entitled[it.key] ?: 0.0) }
        .sortedWith { a, b -> compareNumbers(if (short > 0) b.second - a.second else a.second - b.second) }
        .firstOrNull()
        ?.first
}

/** Drops that did not divide and that nobody has answered for, with the size of the imbalance. */
fun unanswered(
    parties: List<Party>,
    pools: List<PartyLootPool>,
    dropKey: String,
): List<UnansweredDrop> {
    val partyById = parties.associateBy { it.id }
    return pools.flatMap { pool ->
        val party = partyById[pool.partyId]
        if (party == null) emptyList() else pool.loot.mapNotNull { unansweredDrop(pool, party, it, dropKey) }
    }
}

private fun unansweredDrop(
    pool: PartyLootPool,
    party: Party,
    loot: Loot,
    dropKey: String,
): UnansweredDrop? {
    val bundles = bundlesOf(loot)
    val holders = holdersOf(loot, party)
    val open =
        loot.dropKey == dropKey &&
            loot.quantity >= 1 &&
            bundles != null &&
            holders.size >= 2 &&
            heldByHolder(loot, party, holders) == null
    if (!open) return null
    // What the closest-to-even arrangement still leaves misplaced, halved: each misplaced piece is
    // counted once from each end.
    val weight = holders.fold(0.0) { sum, h -> sum + h.shares }
    val size = loot.quantity / bundles!!
    val drift =
        holders.fold(0.0) { sum, h ->
            val entitled = (loot.quantity * h.shares) / weight
            sum + abs(jsRound(entitled / size) * size - entitled)
        }
    val imbalance = jsRound(drift / 2)
    return UnansweredDrop(
        loot.id,
        pool.partyId,
        loot.bossKey,
        loot.weekStart,
        loot.quantity,
        bundles,
        ranSeats(loot, party),
        imbalance,
    )
}
