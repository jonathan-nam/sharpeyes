package com.sharpeyes.api.settlement

import com.sharpeyes.api.AbsentOnCachedPayload
import com.sharpeyes.api.coupons.VestigeHolder
import kotlinx.serialization.Serializable

// Whose pile a proceeds disposal speaks for, as `heldBy` carries it. See V91.
const val HELD_BY_YOU = "YOU"
const val HELD_BY_THEM = "THEM"

@Serializable
data class HeldMoneyResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    /**
     * OFFSET: it came off their debt (THEM: off yours). PAID: you sent it to them (THEM: they sent it
     * to you).
     */
    val kind: String,
    val decidedAt: String,
    /** YOU: your pile sold their coupons. THEM: their pile sold yours. See V91. */
    @AbsentOnCachedPayload
    val heldBy: String = HELD_BY_YOU,
    /** Whether the viewer wrote it. See V88. */
    @AbsentOnCachedPayload
    val recordedByYou: Boolean = true,
    @AbsentOnCachedPayload
    val recordedByName: String? = null,
)

@Serializable
data class AddHeldMoneyRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val kind: String,
    val heldBy: String = HELD_BY_YOU,
)
