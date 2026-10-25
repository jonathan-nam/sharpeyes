package com.sharpeyes.api.settlement

import com.sharpeyes.api.coupons.SOLD
import com.sharpeyes.api.coupons.VestigeTrancheShareRow
import kotlinx.serialization.Serializable

@Serializable
data class SharedTrancheRequest(
    val pieces: Double,
    val amount: Long? = null,
    val disposition: String = SOLD,
    /** Pieces of the sale that were somebody else's, in the owner's book's holder shape. */
    val shares: List<VestigeTrancheShareRow> = emptyList(),
)

@Serializable
data class SharedMoneyRequest(
    /** A debt in the owner's terms (positive is you owing them), or what you paid them. */
    val amount: Long,
    val note: String? = null,
)

@Serializable
data class SharedDisposalRequest(
    val amount: Long,
    /** OFFSET or PAID. */
    val kind: String,
    /** In the owner's terms: THEM is the member holding the owner's money. */
    val heldBy: String,
)
