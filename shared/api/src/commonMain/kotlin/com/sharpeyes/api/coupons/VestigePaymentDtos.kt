package com.sharpeyes.api.coupons

import kotlinx.serialization.Serializable

@Serializable
data class VestigePaymentResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    val receivedAt: String,
    /** The reader wrote it, which is what lets them take it back. See V88. */
    val recordedByYou: Boolean = true,
    /** Who did, as the reader calls them, when it was not the reader. */
    val recordedByName: String? = null,
)

@Serializable
data class AddVestigePaymentRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
)
