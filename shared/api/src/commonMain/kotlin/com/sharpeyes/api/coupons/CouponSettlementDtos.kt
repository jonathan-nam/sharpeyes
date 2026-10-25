package com.sharpeyes.api.coupons

import kotlinx.serialization.Serializable

/** One act of closing a pile, and what it covered. */
@Serializable
data class CouponSettlementResponse(
    val id: String,
    val holder: VestigeHolder,
    val lootIds: List<String>,
    /** Mesos still owed when the books closed. Zero is a pile that balanced. */
    val unpaid: Long,
    val settledAt: String,
)

@Serializable
data class AddCouponSettlementRequest(
    val holder: VestigeHolder,
    val lootIds: List<String>,
    val unpaid: Long = 0,
)
