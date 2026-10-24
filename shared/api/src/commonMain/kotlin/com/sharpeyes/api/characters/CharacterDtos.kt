package com.sharpeyes.api.characters

import kotlinx.serialization.Serializable

@Serializable
data class CharacterResponse(
    val id: String,
    val name: String,
    val level: Int?,
    val jobName: String?,
    val worldName: String?,
    // INTERACTIVE or HEROIC. Inherited from the account when the character is added, and the one
    // this character's parties read to decide whether their loot can be sold at all.
    val worldType: String,
    val spriteImgUrl: String?,
    val spriteRefreshedAt: String?,
    val createdAt: String,
    val updatedAt: String,
)

// Mirrored by frontend's types/character-token.ts field-for-field.
@Serializable
data class CharacterTokenResponse(
    val tokenCatalogId: String,
    val name: String,
    val iconUrl: String?,
    val quantity: Int,
    // Which section of the inventory this belongs in. See TokenCatalog.itemGroup.
    val itemGroup: String?,
    // The boss it drops from ("Kaling", "Limbo", ...). Sent so search can match on it: nobody
    // thinks of the item as "Ferocious Beast Entanglement Ring", they think of it as the thing
    // Kaling drops, and an item you cannot find is an item you have not really tracked.
    val sourceBoss: String?,
    // Null for a consumable. There is no flag: an item is redeemable exactly when it has
    // a redemption rule, so a null threshold IS the answer to "is this redeemable?".
    val redeemThreshold: Int?,
    // Which Eternal pieces this token buys. Empty for a consumable. The two sets do not overlap,
    // so "how many pieces do I have" is a question with two different answers depending on which
    // one you mean.
    val redeemSlots: List<String> = emptyList(),
    val capturedAt: String,
)

/**
 * Typing in what a character holds of one item.
 *
 * ABSOLUTE, exactly as a parse's figure was: "what do you hold" has one answer, and re-typing it
 * corrects a mistake completely. A "+2 after a run" button reads the figure on screen and sends the
 * sum, so what is stored is always a number somebody was looking at rather than a running total
 * nobody has checked. Zero clears the row. See CharacterTokenWrites.kt.
 */
@Serializable
data class SetTokenCountRequest(
    val quantity: Int,
)

@Serializable
data class CreateCharacterRequest(
    val name: String,
)

// No worldType. A character's world is read from the ranking lookup and nowhere else, because a
// world nobody checked is indistinguishable on screen from one that was: six characters in the dev
// database sat recorded as Heroic while playing in Scania, and every page agreed with them. The way
// to fix a wrong world is to ask the game again, which is what refresh does.
@Serializable
data class UpdateCharacterRequest(
    val name: String? = null,
    val level: Int? = null,
)

// The full set of the caller's character ids in their new order. It must be exactly that set,
// no more, no fewer: a partial reorder would leave holes or duplicates in position.
@Serializable
data class ReorderCharactersRequest(
    val orderedIds: List<String>,
)
