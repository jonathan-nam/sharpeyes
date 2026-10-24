package com.sharpeyes.api.system

import kotlinx.serialization.Serializable

@Serializable
data class PingResponse(
    val userId: String,
    val dbTimestamp: String,
)
