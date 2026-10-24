package com.sharpeyes.backend.money

import kotlinx.serialization.Serializable
import kotlin.math.ceil
import kotlin.math.floor

// Splitting boss drop money, and the tax that makes it not-division. The port of
// frontend/lib/drop-split.ts splitDrop, which explains the lazy and fair methods and who pays which
// fee. Until that file is deleted the two must agree to the meso and to the bit: every case in
// src/test/resources/money-golden/drop-split.json is the TypeScript's answer, and
// DropSplitGoldenTest replays them. See docs/backend-arithmetic-plan.md.
//
// The arithmetic is done in Double where the TypeScript does it in floating point, in the same
// order, and floored or ceiled at the same points. Doing it in Long would be "more correct" and
// would disagree with every figure already on screen.

/** The two rates the Auction House charges. MVP pays the lower one. */
const val FEE_MVP = 0.03
const val FEE_STANDARD = 0.05

@Serializable
enum class SplitMethod {
    @kotlinx.serialization.SerialName("lazy")
    LAZY,

    @kotlinx.serialization.SerialName("fair")
    FAIR,
}

/** Which end of the sale the entered figure is. See AmountBasis in drop-split.ts. */
@Serializable
enum class AmountBasis {
    @kotlinx.serialization.SerialName("listed")
    LISTED,

    @kotlinx.serialization.SerialName("received")
    RECEIVED,
}

/** Which way a payout that will not divide is rounded: up for mesos, down for dollars. */
@Serializable
enum class Rounding {
    @kotlinx.serialization.SerialName("up")
    UP,

    @kotlinx.serialization.SerialName("down")
    DOWN,
}

@Serializable
data class SplitInput(
    val amount: Long,
    val amountIs: AmountBasis,
    /** The seller's own rate. Ignored on a received basis. */
    val sellerFee: Double,
    /** One rate per OTHER member. */
    val memberFees: List<Double>,
    val method: SplitMethod,
    val sellerShares: Int = 1,
    /** One count per other member, positional with memberFees. Null is 1 each. */
    val memberShares: List<Int>? = null,
    val rounding: Rounding = Rounding.UP,
)

@Serializable
data class MemberShare(
    val fee: Double,
    val shares: Int,
    /** Mesos to send this member, before the fee on that transfer. */
    val pay: Long,
    /** What they end up holding. */
    val nets: Long,
)

@Serializable
data class Split(
    /** What the drop was listed at, or null when only the received figure is known. */
    val grossSale: Long?,
    val sellerReceives: Long,
    val sellerKeeps: Long,
    val sellerShares: Int,
    /** What one share nets on a fair split, before the receiver's fee. Zero on a lazy split. */
    val netPerShare: Double,
    val members: List<MemberShare>,
    val totalFee: Long,
    val totalFeeCoversSale: Boolean,
)

/**
 * The split of one sale. Throws IllegalArgumentException where the TypeScript throws RangeError: a
 * rate outside [0, 1), a negative amount, shares of the wrong length, a negative share, or nobody
 * taking a share.
 */
fun splitDrop(input: SplitInput): Split = input.split(validated(input))

private fun SplitInput.split(shares: List<Int>): Split {
    val entered = amount
    val grossSale = if (amountIs == AmountBasis.LISTED) entered else null
    val sellerReceives =
        if (amountIs == AmountBasis.LISTED) floor(entered.toDouble() * (1 - sellerFee)).toLong() else entered

    // Every share is worth the same X afterwards. See the derivation in drop-split.ts.
    val netPerShare =
        if (method == SplitMethod.FAIR && memberFees.isNotEmpty()) {
            sellerReceives /
                (sellerShares + memberFees.foldIndexed(0.0) { i, sum, fee -> sum + shares[i] / (1 - fee) })
        } else {
            0.0
        }

    val totalShares = sellerShares + shares.sum()

    fun exact(
        fee: Double,
        count: Int,
    ): Double =
        if (method == SplitMethod.FAIR) {
            (netPerShare * count) / (1 - fee)
        } else {
            (sellerReceives.toDouble() * count) / totalShares
        }

    fun payouts(round: (Double) -> Double) = memberFees.mapIndexed { i, fee -> round(exact(fee, shares[i])).toLong() }

    // Rounding up can overshoot a purse too small to divide; floor is the fallback.
    var pays = payouts(if (rounding == Rounding.UP) ::ceil else ::floor)
    if (pays.sum() > sellerReceives) pays = payouts(::floor)

    val members =
        memberFees.mapIndexed { i, fee ->
            val pay = pays[i]
            MemberShare(fee, shares[i], pay, floor(pay * (1 - fee)).toLong())
        }
    val paidOut = members.sumOf { it.pay }
    val sellerKeeps = sellerReceives - paidOut
    val received = members.sumOf { it.nets }

    return Split(
        grossSale = grossSale,
        sellerReceives = sellerReceives,
        sellerKeeps = sellerKeeps,
        sellerShares = sellerShares,
        netPerShare = netPerShare,
        members = members,
        totalFee = (grossSale ?: sellerReceives) - sellerKeeps - received,
        totalFeeCoversSale = grossSale != null,
    )
}

/** The member share counts, after every refusal splitDrop makes. */
private fun validated(input: SplitInput): List<Int> {
    // The seller's rate is unused on a received basis, so a nonsense one there is not refused.
    val rates =
        if (input.amountIs ==
            AmountBasis.LISTED
        ) {
            listOf(input.sellerFee) + input.memberFees
        } else {
            input.memberFees
        }
    for (fee in rates) {
        require(fee.isFinite() && fee >= 0 && fee < 1) { "fee must be at least 0 and below 1, got $fee" }
    }
    require(input.amount >= 0) { "amount must be zero or more, got ${input.amount}" }
    val shares = input.memberShares ?: input.memberFees.map { 1 }
    require(shares.size == input.memberFees.size) { "memberShares must be one per member, got ${shares.size}" }
    for (count in listOf(input.sellerShares) + shares) {
        require(count >= 0) { "a share count must be a whole number of 0 or more, got $count" }
    }
    require(input.sellerShares + shares.sum() >= 1) { "at least one seat has to take a share" }
    return shares
}
