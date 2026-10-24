package com.sharpeyes.api.sprites

import kotlinx.serialization.Serializable

@Serializable
data class SpriteLookupRequest(
    val names: List<String>,
)

/**
 * Each name as sent, to its sprite's proxy path and its job, either null where Nexon has no such
 * character.
 */
@Serializable
data class SpriteLookupResponse(
    val sprites: Map<String, String?>,
    val jobs: Map<String, String?> = emptyMap(),
)
