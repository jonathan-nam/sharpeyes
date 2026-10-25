package com.sharpeyes.api.planner

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** What was last saved, or nulls for an account that never has. */
@Serializable
data class SavedPlannerResponse(
    val draft: JsonElement?,
    val savedAt: String?,
)

@Serializable
data class SavePlannerRequest(
    val draft: JsonElement,
)
