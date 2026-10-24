package com.sharpeyes.money.split

import com.sharpeyes.money.Loot
import com.sharpeyes.money.PartyMember
import kotlinx.serialization.Serializable
import kotlin.math.floor

// Turning a recorded sale into what each member is owed: the port of frontend/lib/loot.ts's money.
// The arithmetic is splitDrop's (DropSplit.kt); this only feeds it.

/** MESO or USD. */
@Serializable
data class Money(
    val amount: Double,
    val currency: String,
)

@Serializable
data class Share(
    val memberId: String,
    val name: String,
    val fee: Double,
    val shares: Double,
    /** What to send them, before the fee on that transfer, in the sale's own currency. */
    val pay: Double,
    val nets: Double,
    val paid: Boolean,
)

@Serializable
data class SellerSplit(
    val memberId: String,
    val name: String,
    val keeps: Double,
    val paysOut: Double,
    val shares: Double,
)

@Serializable
data class LootSplit(
    val seller: SellerSplit,
    val shares: List<Share>,
    val split: Split,
    val currency: String,
)

/** The standard rate for everybody: MVP tiers are not tracked. */
fun memberFee(): Double = FEE_STANDARD

/** Whether a drop divides at all: more than one seat ran it. */
fun divides(ran: List<PartyMember>): Boolean = ran.size > 1

/** What this drop sold for and in which unit, or null if it has not sold. Dollars first. */
fun saleMoney(
    saleAmount: Double?,
    saleUsdCents: Double?,
): Money? {
    if (saleUsdCents != null) return Money(saleUsdCents, "USD")
    return saleAmount?.let { Money(it, "MESO") }
}

fun saleMoney(loot: Loot): Money? = saleMoney(loot.saleAmount, loot.saleUsdCents)

/** BOUGHT reads as received: nothing was listed. Null for a basis this build does not know. */
private fun basisOf(stored: String): AmountBasis? =
    when (stored) {
        "LISTED" -> AmountBasis.LISTED
        "RECEIVED", "BOUGHT" -> AmountBasis.RECEIVED
        else -> null
    }

private fun isWholeAtLeastOne(n: Double) = n == floor(n) && n >= 1

/** Every seat the sale names is in the party, and every share count is a whole number of at least one. */
private fun seatsReadable(
    seller: PartyMember?,
    payees: List<PartyMember?>,
    shares: List<Double>,
): Boolean = seller != null && payees.all { it != null } && shares.all(::isWholeAtLeastOne)

/** What this sold drop owes each member, or null when it cannot be worked out. See loot.ts. */
fun splitOf(
    loot: Loot,
    members: List<PartyMember>,
): LootSplit? {
    val money = saleMoney(loot)
    val amountIs = loot.amountBasis?.let(::basisOf)
    val byId = members.associateBy { it.id }
    val seller = loot.sellerMemberId?.let { byId[it] }
    val owed = loot.payouts.map { it to byId[it.memberId] }
    val sellerShares = loot.sellerShares ?: 1.0
    val memberShares = owed.map { it.first.shares }
    val sale = money != null && amountIs != null && loot.splitMethod != null
    if (!sale || !seatsReadable(seller, owed.map { it.second }, listOf(sellerShares) + memberShares)) return null

    // Real money crossed no Auction House, so no cut either way.
    val fee = if (money!!.currency == "USD") 0.0 else memberFee()
    val split =
        splitDrop(
            SplitInput(
                amount = money.amount.toLong(),
                amountIs = amountIs!!,
                sellerFee = fee,
                memberFees = owed.map { fee },
                method = if (loot.splitMethod == "FAIR") SplitMethod.FAIR else SplitMethod.LAZY,
                sellerShares = sellerShares.toInt(),
                memberShares = memberShares.map { it.toInt() },
                rounding = if (money.currency == "USD") Rounding.DOWN else Rounding.UP,
            ),
        )
    val sellerSplit =
        SellerSplit(
            memberId = seller!!.id,
            name = seller.name,
            keeps = split.sellerKeeps.toDouble(),
            paysOut = (split.sellerReceives - split.sellerKeeps).toDouble(),
            shares = split.sellerShares.toDouble(),
        )
    val shares =
        owed.mapIndexed { i, (payout, member) ->
            val m = split.members.getOrNull(i)
            Share(
                memberId = payout.memberId,
                name = member!!.name,
                fee = m?.fee ?: 0.0,
                shares = m?.shares?.toDouble() ?: 1.0,
                pay = m?.pay?.toDouble() ?: 0.0,
                nets = m?.nets?.toDouble() ?: 0.0,
                paid = payout.paid,
            )
        }
    return LootSplit(sellerSplit, shares, split, money.currency)
}
