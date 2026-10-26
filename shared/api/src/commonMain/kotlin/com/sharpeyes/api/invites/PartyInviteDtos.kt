package com.sharpeyes.api.invites

import kotlinx.serialization.Serializable

/** A pending invite as the party's owner sees it. */
@Serializable
data class PendingInviteView(
    val id: String,
    val name: String,
)

/** A pending invite as the invitee sees it: named the way the bell names it. See partyFacts. */
@Serializable
data class IncomingInviteView(
    val id: String,
    val partyId: String,
    /** Which of your characters it offers the seat to. */
    val character: String,
    val boss: String,
    val difficulty: String?,
    /** The party owner's character. */
    val leader: String,
)

/** A pending invite as the party's owner sees it on Social, so one on a solo pool can be withdrawn. */
@Serializable
data class SentInviteView(
    val id: String,
    val partyId: String,
    /** The friend's character it offers the seat to. */
    val character: String,
    val boss: String,
    val difficulty: String?,
    /** Your character. */
    val leader: String,
)
