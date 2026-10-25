package com.sharpeyes.api.invites

import kotlinx.serialization.Serializable

/** A config the link could not carry, named so the drop is visible rather than inferred. */
@Serializable
data class InviteOmission(
    val bossKey: String,
    val characterName: String,
    val reason: String,
)

/**
 * Who to make a link for. That is the whole of it.
 *
 * No name: the sender was asked one, and being asked is what made a one-click action into a form.
 * The account already holds a name a friend knows them by, and the recipient can rename them on
 * their own people list afterwards, so asking bought nothing that could not be corrected. See
 * senderNameFor.
 */
@Serializable
data class CreateInviteRequest(
    val personId: String,
)

/**
 * What the recipient confirmed is theirs, by character name.
 *
 * Null is every character in the payload, which is what a client that does not ask sends. The names
 * are the sender's spelling of YOUR characters, and they are the one thing on a link that has to be
 * right: a character confirmed by mistake is a seat bound to it, nights you were not on, and a
 * figure in your Drop Log for a share you are not owed.
 */
@Serializable
data class AcceptInviteRequest(
    val characters: List<String>? = null,
)

/**
 * A link the sender has made.
 *
 * `token` is set on the response to CREATE and never again: it is not stored, only its hash is, so
 * a link that was not copied is replaced rather than recovered.
 */
@Serializable
data class InviteResponse(
    val id: String,
    val personId: String,
    val personName: String,
    val senderName: String,
    val token: String? = null,
    val createdAt: String,
    val expiresAt: String,
    val accepted: Boolean,
    val characterCount: Int,
    val partyCount: Int,
    val omitted: List<InviteOmission> = emptyList(),
)

/** One config on a link's landing page: what it is, in words a person recognises. */
@Serializable
data class InvitePartyLabel(
    val bossName: String,
    val difficulty: String?,
    /**
     * Which of the recipient's characters holds the seat, which is what tells two of these apart.
     *
     * A boss run on three characters is three configs with one label between them, and the same
     * line three times reads as a bug in the list rather than as three parties. It is also what
     * says which ticked character a party arrives with: a config binds no seat unless the name on
     * it was confirmed, so unticking a character drops its parties. See takeSeats.
     */
    val characterName: String,
)

/**
 * What the landing page shows somebody who is not signed in yet.
 *
 * Deliberately thin. Anyone holding the URL sees this, so it names the sender, the characters they
 * attributed to the recipient and the parties involved, and nothing that is not already implied by
 * having been sent the link.
 */
@Serializable
data class InvitePreview(
    val senderName: String,
    // The sender's own sprite for that character, as /api/characters would hand it to them. Null
    // when their account has never found one.
    val senderSprite: String? = null,
    val characters: List<String>,
    /**
     * The configs this link seats you in, one entry each, for showing a few of them by name.
     *
     * The boss's NAME rather than its key, because this page is read before anyone signs in and so
     * cannot fetch the catalog to turn one into the other. The difficulty stays raw for the client
     * to run through difficultyLabel, which is where every other screen formats one.
     */
    val parties: List<InvitePartyLabel> = emptyList(),
    val peopleCount: Int,
    val omitted: List<InviteOmission> = emptyList(),
)

/** What accepting created. Counts, because a count that changed is the thing worth saying. */
@Serializable
data class AcceptedInvite(
    val charactersCreated: Int,
    val peopleCreated: Int,
    val partiesCreated: Int,
    val omitted: List<InviteOmission> = emptyList(),
)
