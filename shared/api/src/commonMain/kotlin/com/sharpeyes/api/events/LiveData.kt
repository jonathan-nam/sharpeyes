package com.sharpeyes.api.events

import kotlinx.serialization.Serializable

/** Who and what, for the page to show on the thing that moved. Never who else was told. */
@Serializable
data class LiveData(
    val actor: String?,
    val image: String?,
    val target: EventTarget,
)

/**
 * What a change touched, as precisely as its writer knows: a party, one of its drops, or a person's
 * Settlement card (the owner's person row, which is the key of both sides' card). Nothing named is a
 * change the page reads again without pointing at anything.
 */
@Serializable
data class EventTarget(
    val party: String? = null,
    val loot: String? = null,
    val person: String? = null,
)
