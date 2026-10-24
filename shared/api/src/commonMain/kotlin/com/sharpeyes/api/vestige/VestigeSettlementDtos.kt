package com.sharpeyes.api.vestige

import kotlinx.serialization.Serializable

/** One act of closing a pile, and what it covered. */
@Serializable
data class VestigeSettlementResponse(
    val id: String,
    val holder: VestigeHolder,
    val lootIds: List<String>,
    /** Mesos still owed when the books closed. Zero is a pile that balanced. */
    val unpaid: Long,
    val settledAt: String,
)

@Serializable
data class AddVestigeSettlementRequest(
    val holder: VestigeHolder,
    val lootIds: List<String>,
    val unpaid: Long = 0,
)
