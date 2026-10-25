package com.sharpeyes.api.inventory

import kotlinx.serialization.Serializable

// Mirrored by frontend's types/token-total.ts field-for-field.
@Serializable
data class ItemTotalResponse(
    val tokenCatalogId: String,
    val name: String,
    val iconUrl: String?,
    val quantity: Int,
    // Which section of the inventory this belongs in. See TokenCatalog.itemGroup.
    val itemGroup: String?,
    // Null for a consumable. There is no flag: an item is redeemable exactly when it has
    // a redemption rule, so a null threshold IS the answer to "is this redeemable?".
    val redeemThreshold: Int?,
    // How many characters contributed to `quantity`. Without it, a total of 40 is
    // ambiguous between one hoarder and ten mules, which is exactly the question
    // the aggregate view exists to answer.
    val characterCount: Int,
)
