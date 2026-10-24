package com.sharpeyes.api.invites

import kotlinx.serialization.Serializable

/** A pending invite as the party's owner sees it. */
@Serializable
data class PendingInviteView(
    val id: String,
    val name: String,
)
