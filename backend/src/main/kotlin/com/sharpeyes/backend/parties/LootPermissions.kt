package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.Refusal
import kotlin.uuid.Uuid

// What a member may do to a row in a pool they do not own, beyond canEditParty. The owner passes
// every check here. A member acts only as their own seat, so a debt is never recorded in somebody
// else's name. See docs/shared-parties-plan.md. Inside a transaction, like the rest.

/**
 * Selling as [sellerId], or correcting a sale already on [loot]: only a drop you logged (see
 * loggerRefusal), and a member only as their own seat.
 */
internal fun sellRefusal(
    partyId: Uuid,
    userId: String,
    sellerId: Uuid?,
    loot: LootResponse,
): Refusal? {
    val theirs = loot.sellerMemberId?.let(Uuid::parse)
    val allowed = mayActAs(partyId, userId, sellerId) && (theirs == null || mayActAs(partyId, userId, theirs))
    return loggerRefusal(loot)
        ?: if (allowed) null else Refusal("You can only record your own sales. Pick yourself as the seller.")
}

/**
 * Selling [loot] at all: whoever logged it sells it, owner or member, and the rest of the party
 * reads it. A drop logged before V84 has no recorder and is the owner's.
 */
internal fun loggerRefusal(loot: LootResponse): Refusal? =
    if (loot.recordedByYou) null else Refusal("Someone else logged this drop. They record its sale.")

/** Saying who picked up which stacks of [loot]: the owner, or whoever logged it, as they sell it. */
internal fun stacksRefusal(
    partyId: Uuid,
    userId: String,
    loot: LootResponse,
): Refusal? =
    if (ownsParty(partyId, userId) || loot.recordedByYou) {
        null
    } else {
        Refusal("Someone else logged this drop. They say who picked up which stacks.")
    }

/** Undoing [loot]'s sale: its seller or the owner. */
internal fun unsellRefusal(
    partyId: Uuid,
    userId: String,
    loot: LootResponse,
): Refusal? =
    if (mayActAs(partyId, userId, loot.sellerMemberId?.let(Uuid::parse))) {
        null
    } else {
        Refusal("Only the seller or the party's owner can undo this sale.")
    }

/** Marking [loot] kept by [memberId], or putting it back: a member's own seat either way. */
internal fun keptRefusal(
    partyId: Uuid,
    userId: String,
    memberId: Uuid?,
    loot: LootResponse,
): Refusal? =
    if (mayActAs(partyId, userId, memberId ?: loot.takenByMemberId?.let(Uuid::parse))) {
        null
    } else {
        Refusal("You can only mark a drop kept by yourself.")
    }

/**
 * Marking [memberId]'s share of [loot] paid, or unpaid: the owner, or a member on either end of it,
 * since the shared book is both sides' to keep.
 */
internal fun payoutRefusal(
    partyId: Uuid,
    userId: String,
    memberId: Uuid,
    loot: LootResponse,
): Refusal? =
    if (mayActAs(partyId, userId, memberId) || mayActAs(partyId, userId, loot.sellerMemberId?.let(Uuid::parse))) {
        null
    } else {
        Refusal("You can only mark a share you sent or were sent.")
    }

/** Deleting [loot]:the owner, or a member taking back a drop they logged that nobody has sold or kept. */
internal fun mayDeleteLoot(
    partyId: Uuid,
    userId: String,
    loot: LootResponse?,
): Boolean {
    val untouched = loot != null && loot.recordedByYou && loot.soldAt == null && loot.takenByMemberId == null
    return loot != null && (ownsParty(partyId, userId) || (untouched && canEditParty(partyId, userId)))
}
