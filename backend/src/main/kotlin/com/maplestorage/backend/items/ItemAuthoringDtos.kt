package com.maplestorage.backend.items

import com.maplestorage.backend.services.UntrackedSlot
import kotlinx.serialization.Serializable

@Serializable
data class UntrackedItemsRequest(
    val imageBase64: String,
    val mediaType: String,
)

@Serializable
data class UntrackedItemsResponse(
    val slots: List<UntrackedSlot>,
    // How many slots the catalog did claim. Context for the picker, nothing depends on it.
    val knownCount: Int,
)

@Serializable
data class ItemTemplateRequest(
    val imageBase64: String,
    val mediaType: String,
    val row: Int,
    val col: Int,
)

@Serializable
data class ItemTemplateResponse(
    val templatePng: String,
    val coverage: Double,
)
