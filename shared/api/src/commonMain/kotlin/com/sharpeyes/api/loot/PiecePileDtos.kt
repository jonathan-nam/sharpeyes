package com.sharpeyes.api.loot

import kotlinx.serialization.Serializable

@Serializable
data class PieceTakeResponse(
    val memberId: String,
    val quantity: Int,
)

@Serializable
data class PiecePileResponse(
    val partyId: String,
    val weekStart: String,
    val tokenCatalogId: String,
    val tokenName: String,
    val iconUrl: String?,
    val difficulty: String,
    val total: Int,
    val stackSize: Int,
    val takes: List<PieceTakeResponse>,
)

@Serializable
data class SavePiecePileRequest(
    val weekStart: String,
    val total: Int,
    // Seat id to pieces taken. Every seat sent; one left out took none.
    val takes: Map<String, Int>,
)
