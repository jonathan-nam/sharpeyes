package com.sharpeyes.api.vestige

import kotlinx.serialization.Serializable

@Serializable
data class ProceedsDisposalResponse(
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
    val heldBy: String = HELD_BY_YOU,
    /** Whether the viewer wrote it. See V88. */
    val recordedByYou: Boolean = true,
    val recordedByName: String? = null,
)

@Serializable
data class AddProceedsDisposalRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val kind: String,
    val heldBy: String = HELD_BY_YOU,
)
