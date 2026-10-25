package com.sharpeyes.api.pages

import com.sharpeyes.api.AbsentOnCachedPayload
import com.sharpeyes.api.coupons.CouponSaleResponse
import com.sharpeyes.api.coupons.CouponSettlementResponse
import com.sharpeyes.api.coupons.PaymentResponse
import com.sharpeyes.api.loot.PartyLootPoolResponse
import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.settlement.HeldMoneyResponse
import com.sharpeyes.api.settlement.SettlementDebtResponse
import kotlinx.serialization.Serializable

/** One owner's book, cut to what it says between them and you. */
@Serializable
data class SharedPartiesResponse(
    /** What you call them: your own person row for their account, else their main character. */
    val ownerName: String,
    /** Their current Discord avatar. See imagesOf. */
    @AbsentOnCachedPayload
    val ownerImage: String? = null,
    /** The owner's person row for YOU. Your card in their book is `person:<this>`. */
    val personId: String,
    /** YOUR person row for their account, which is who they are when the book is read from your side. */
    @AbsentOnCachedPayload
    val ownerPersonId: String?,
    val parties: List<PartyResponse>,
    val pools: List<PartyLootPoolResponse>,
    val tranches: List<CouponSaleResponse>,
    val payments: List<PaymentResponse>,
    val settlements: List<CouponSettlementResponse>,
    val debts: List<SettlementDebtResponse>,
    val disposals: List<HeldMoneyResponse>,
)
