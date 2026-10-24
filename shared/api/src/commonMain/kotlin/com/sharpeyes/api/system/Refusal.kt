package com.sharpeyes.api.system

import kotlinx.serialization.Serializable

/**
 * A refusal worded for users, which the frontend shows as-is.
 *
 * Every other error body (a plain string, or none) stays off screen and the page says its own
 * "Couldn't save that." So a refusal is only one of these if a user can hit it through the UI and
 * do something about it. Lead with the verb that fixes it, in the product's words.
 */
@Serializable
data class Refusal(
    val refusal: String,
)
