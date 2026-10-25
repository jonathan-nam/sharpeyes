package com.sharpeyes.api.inventory

import kotlinx.serialization.Serializable

/** Why a cleared boss's pieces were not added. Shown beside the setting. */
enum class PieceSyncGap {
    // No config names the mode this character runs the boss at.
    NO_DIFFICULTY,

    // Cleared in a week its standing party was taken off, so who ran it is not known.
    PARTY_OFF,

    // A pooled drop in a party whose pieces nobody has added yet. Never listed: Party View's Add
    // button on the party is that message, where it can be acted on.
    PARTY_LOOT,
}

/** A cleared boss whose pieces are not in the inventory, and why. */
@Serializable
data class PieceSyncGapResponse(
    val characterId: String,
    val characterName: String,
    val bossKey: String,
    val bossName: String,
    val reason: PieceSyncGap,
)

@Serializable
data class PieceSyncResponse(
    val enabled: Boolean,
    val gaps: List<PieceSyncGapResponse>,
)

@Serializable
data class SavePieceSyncRequest(
    val enabled: Boolean,
)
