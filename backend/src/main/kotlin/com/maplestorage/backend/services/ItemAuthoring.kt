package com.maplestorage.backend.services

import kotlinx.serialization.Serializable

// Adding an item the catalog does not know about, from the user's own screenshot.
//
// Split from ScreenshotParser because the two ask the vision service opposite questions.
// Parsing asks "what of the catalog is in this frame", and its answer is counts. Authoring
// asks "what in this frame is NOT the catalog", and its answer is pixels a human still has
// to name. A capture that parses perfectly can be useless for authoring: parsing tolerates a
// rescaled screenshot because the catalog is scaled up to meet it, while a template cut from
// one is a blurred guess at the client's pixels and poisons every future parse.

@Serializable
data class UntrackedSlot(
    val row: Int,
    val col: Int,
    // The slot's own pixels, PNG, base64. Pixels carry no names and only a human can supply
    // one, so the picker shows the item rather than describing it.
    val imagePng: String,
)

sealed interface DiscoverOutcome {
    // `slots` is MOST of an inventory, not a shortlist: 65-87 of 128 across the reference
    // captures, because a player's tab is mostly scrolls, cubes and coupons. It answers
    // "what could be tracked" and never "what went wrong".
    data class Found(
        val slots: List<UntrackedSlot>,
        val knownCount: Int,
    ) : DiscoverOutcome

    data class Failed(
        val reason: String,
    ) : DiscoverOutcome
}

sealed interface TemplateOutcome {
    data class Cut(
        // An RGBA PNG: the item's pixels with the stack-count digits and the slot-lock bar
        // masked out, so what is stored is the item rather than this screenshot of it.
        val templatePng: String,
        val coverage: Double,
    ) : TemplateOutcome

    // The pixels are already in the catalog, or are a recolour close enough that the verifier
    // could not tell them apart.
    //
    // Deliberately NOT folded into Failed. Failed means the capture was wrong and the user
    // should fix it; this means the capture was fine and there is nothing to add. Collapsing
    // the two would tell someone to re-take a screenshot that was never the problem.
    data class AlreadyTracked(
        val reason: String,
    ) : TemplateOutcome

    data class Failed(
        val reason: String,
    ) : TemplateOutcome
}

interface ItemAuthoring {
    /** Every slot in this capture that no catalog item claims. */
    suspend fun discoverUntracked(
        imageBytes: ByteArray,
        mediaType: String,
    ): DiscoverOutcome

    /** One slot's pixels as a matching template, or a refusal to make one. */
    suspend fun cutTemplate(
        imageBytes: ByteArray,
        mediaType: String,
        row: Int,
        col: Int,
    ): TemplateOutcome
}
