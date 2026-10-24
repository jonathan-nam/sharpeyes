package com.sharpeyes.api.vestige

import kotlinx.serialization.Serializable

@Serializable
data class SettlementListingView(
    val id: String,
    val personId: String,
    /** OWNER or MEMBER: the side holding the money, who the listing is for. */
    val payer: String,
    val amount: Long,
    val postedByYou: Boolean,
    val createdAt: String,
)

@Serializable
data class ReportedFigure(
    val personId: String,
    val payer: String,
    /** Mesos the payer holds for the other side, as the reporter's screen works it out. */
    val amount: Long,
)

@Serializable
data class ReportFiguresRequest(
    val figures: List<ReportedFigure>,
)
