package com.sharpeyes.backend.invites

import com.sharpeyes.api.invites.InviteOmission
import kotlinx.serialization.Serializable

// What a sign-on link carries, and what the routes say about one. The payload is written into
// account_invite.payload when the link is made and read back untouched when it is accepted, so
// every type here is a stored format: adding an optional field is safe, changing what one means is
// not. See INVITE_PAYLOAD_VERSION.

/**
 * The shape of a stored payload.
 *
 * Checked on accept and refused rather than half-read. The alternative to refusing an old document
 * is filling the fields it lacks with defaults, which builds a roster that is confidently not the
 * one the sender saw.
 */
const val INVITE_PAYLOAD_VERSION = 1

/**
 * One account, written from the other side of the parties two people share.
 *
 * Everything here is the SENDER's data re-anchored on the recipient: the characters are the ones
 * the sender attributed to them, the people are the sender and whoever else sits in the shared
 * configs, and each config is one of the sender's turned around so the recipient's character is the
 * one it belongs to.
 *
 * What is deliberately absent: loot, sales, clears, week rosters, and every config the recipient
 * has no seat in. Those are the sender's record of what happened, not a description of the party.
 */
@Serializable
data class InvitePayload(
    val version: Int,
    // What the recipient will see the sender called. Typed by the sender, because nothing on the
    // account is a name a friend would recognise: users holds an email and an id.
    val senderName: String,
    // The sender's account id, so accept can bind person.linked_user_id from both ends at once.
    val senderUserId: String,
    // INTERACTIVE or HEROIC, from the sender's account. A world is the unit a party lives in, so
    // two people who run together are in the same one.
    val worldType: String,
    val characters: List<InviteCharacter>,
    val people: List<InvitePerson>,
    val parties: List<InviteParty>,
    // Configs the sender has that this link does NOT carry, and why. A dropped config is a count
    // that changed, so it is said on the sender's link and again on the recipient's landing page.
    val omitted: List<InviteOmission> = emptyList(),
    // The sprite this account already found for a character, by name. Copied rather than looked up
    // again: the URL encodes the outfit and the cache is content-addressed on it, so the recipient's
    // roster draws from bytes that are already warm.
    val sprites: Map<String, String> = emptyMap(),
)

/** One of the recipient's own characters, as the sender has them recorded. */
@Serializable
data class InviteCharacter(
    val name: String,
    val worldType: String,
)

/**
 * Somebody the recipient runs with, the sender included.
 *
 * `characters` is only those that appear in a shared config, not everything the sender knows about
 * them. The rest of the sender's address book is not the recipient's to receive, and a seat with no
 * owner is already the ordinary case on every board that draws one.
 */
@Serializable
data class InvitePerson(
    val name: String,
    val characters: List<String>,
    // True for the one person who is the sender. Their row is the one that gets linked_user_id.
    val isSender: Boolean = false,
)

/**
 * One config, turned around.
 *
 * `ownName` is the recipient's character the config will belong to, and `members` is every other
 * seat in the sender's own seat order, the sender's character among them. That inversion is the
 * whole point: the same roster, anchored on the other end.
 */
@Serializable
data class InviteParty(
    // The config on the sender's account whose seats this fills. It stays theirs and is never
    // copied, so this is the party itself rather than a row to pair with one (V75). A config
    // deleted since the link was made seats nobody, which is what a stale invitation looks like.
    val sourcePartyId: String,
    val bossKey: String,
    val difficulty: String? = null,
    val minutes: Int? = null,
    val ownName: String,
    val members: List<String>,
    // What each seat takes of a split, by name. A name left out takes one.
    val shares: Map<String, Int> = emptyMap(),
)

/**
 * A config dropped because that character already has one for the boss.
 *
 * One character runs one boss (idx_party_character_boss), so two of the sender's configs seating
 * the same character of yours on the same boss cannot both become yours.
 */
const val OMITTED_DUPLICATE_BOSS = "already has a config for this boss"

/**
 * A config dropped because the catalog no longer has its boss.
 *
 * Only reachable through a frozen payload: bosses.yaml is the source of truth and a link outlives
 * one re-seed of it. Named rather than skipped, for the same reason as the duplicate above.
 */
const val OMITTED_UNKNOWN_BOSS = "this boss is no longer in the catalog"
