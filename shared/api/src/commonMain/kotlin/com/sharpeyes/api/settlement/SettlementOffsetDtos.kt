package com.sharpeyes.api.settlement

import com.sharpeyes.api.coupons.VestigeHolder
import com.sharpeyes.api.loot.PartyLootPoolResponse
import kotlinx.serialization.Serializable

/** One share the act discharges, with the figure the card quoted for it. */
@Serializable
data class OffsetPartRow(
    val lootId: String,
    val memberId: String,
    /**
     * This seat's share, pre-fee and POSITIVE. The entry it becomes is minus this.
     *
     * Absent when nothing is being priced, which is every share on the /sent path: money that left
     * your hands takes nothing off what they owe you, so there is no entry to carry a figure. An
     * offset that omits it is refused rather than writing an entry of nought: see closeRefusal.
     */
    val amount: Long = 0,
)

/**
 * Closing what you owe somebody, as ONE act. See V57 and V61.
 *
 * The client's figure per share, not one derived here. It is what the button quoted before it was
 * pressed, and a server that recomputed it could record a sum nobody agreed to: the pre-fee and
 * post-fee readings of one share differ by 5%, which is a discrepancy this card has already shipped
 * once.
 */
@Serializable
data class OffsetSharesRequest(
    val holder: VestigeHolder,
    val note: String? = null,
    val parts: List<OffsetPartRow> = emptyList(),
    /**
     * Mesos of THEIRS you are holding that this act decides about, where there are any. See V61.
     *
     * The second pot the one button moves, and the reason it is in this request rather than one of
     * its own: see writeClose.
     */
    val holding: Long? = null,
    /**
     * Shares THEY owe you that the act closes too, so one press settles the pair both ways (closingNet
     * on the client, 2026-10-25). An offset takes each off what you owe them: an entry of plus this.
     */
    val received: List<OffsetPartRow> = emptyList(),
    /** Mesos of YOURS they are holding that the act decides about. Written as heldBy THEM. */
    val heldByThem: Long? = null,
)

/**
 * Every list the act moved.
 *
 * One answer because it was one write. Handing back the debts alone would leave the caller to fetch
 * the pools, which is the second round trip this endpoint exists to remove.
 */
@Serializable
data class OffsetSharesResponse(
    val pools: List<PartyLootPoolResponse>,
    val debts: List<SettlementDebtResponse>,
    val disposals: List<HeldMoneyResponse>,
)
