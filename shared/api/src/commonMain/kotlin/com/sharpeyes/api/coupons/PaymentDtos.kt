package com.sharpeyes.api.coupons

import com.sharpeyes.api.AbsentOnCachedPayload
import kotlinx.serialization.Serializable

@Serializable
data class PaymentResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    val receivedAt: String,
    /** The reader wrote it, which is what lets them take it back. See V88. */
    @AbsentOnCachedPayload
    val recordedByYou: Boolean = true,
    /** Who did, as the reader calls them, when it was not the reader. */
    @AbsentOnCachedPayload
    val recordedByName: String? = null,
)

@Serializable
data class AddPaymentRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
)
