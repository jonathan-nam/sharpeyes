package com.sharpeyes.api.inventory

import kotlinx.serialization.Serializable

/**
 * One item, with no count attached.
 *
 * Deliberately NOT CharacterItemResponse with a zero: that one carries a quantity and a capturedAt,
 * and inventing both to describe an item nobody holds is two figures nobody said.
 */
@Serializable
data class ItemCatalogResponse(
    val tokenCatalogId: String,
    val name: String,
    val iconUrl: String?,
    val itemGroup: String?,
    val sourceBoss: String?,
    val redeemThreshold: Int?,
    val redeemSlots: List<String> = emptyList(),
)
