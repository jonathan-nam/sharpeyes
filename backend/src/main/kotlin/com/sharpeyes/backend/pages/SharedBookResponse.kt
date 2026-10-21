package com.sharpeyes.backend.pages

import com.sharpeyes.backend.parties.PartyLootPoolResponse
import com.sharpeyes.backend.parties.PartyResponse
import com.sharpeyes.backend.parties.ProceedsDisposalResponse
import com.sharpeyes.backend.parties.SettlementDebtResponse
import com.sharpeyes.backend.parties.VestigePaymentResponse
import com.sharpeyes.backend.parties.VestigeSettlementResponse
import com.sharpeyes.backend.parties.VestigeTrancheResponse
import kotlinx.serialization.Serializable

/** One owner's book, cut to what it says between them and you. */
@Serializable
data class SharedBookResponse(
    /** What you call them: your own person row for their account, else their main character. */
    val ownerName: String,
    /** Their current Discord avatar. See imagesOf. */
    val ownerImage: String? = null,
    /** The owner's person row for YOU. Your card in their book is `person:<this>`. */
    val personId: String,
    /** YOUR person row for their account, which is who they are when the book is read from your side. */
    val ownerPersonId: String?,
    val parties: List<PartyResponse>,
    val pools: List<PartyLootPoolResponse>,
    val tranches: List<VestigeTrancheResponse>,
    val payments: List<VestigePaymentResponse>,
    val settlements: List<VestigeSettlementResponse>,
    val debts: List<SettlementDebtResponse>,
    val disposals: List<ProceedsDisposalResponse>,
)
