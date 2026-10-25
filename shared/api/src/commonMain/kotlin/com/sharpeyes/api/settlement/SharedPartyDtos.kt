package com.sharpeyes.api.settlement

import com.sharpeyes.api.coupons.CouponSaleShareRow
import com.sharpeyes.api.coupons.SOLD
import kotlinx.serialization.Serializable

@Serializable
data class SharedTrancheRequest(
    val pieces: Double,
    val amount: Long? = null,
    val disposition: String = SOLD,
    /** Pieces of the sale that were somebody else's, in the owner's book's holder shape. */
    val shares: List<CouponSaleShareRow> = emptyList(),
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

/**
 * A closing act from the member's side, in the owner's terms: `parts` are shares the owner owes the
 * member, `received` shares the member owes the owner, `holding` the member's money the owner holds,
 * `heldByThem` the owner's money the member holds. The same pots OffsetSharesRequest carries.
 */
@Serializable
data class SharedCloseRequest(
    val note: String? = null,
    val parts: List<OffsetPartRow> = emptyList(),
    val holding: Long? = null,
    val received: List<OffsetPartRow> = emptyList(),
    val heldByThem: Long? = null,
)
