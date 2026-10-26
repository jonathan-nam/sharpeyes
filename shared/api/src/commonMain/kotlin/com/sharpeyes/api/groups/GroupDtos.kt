package com.sharpeyes.api.groups

import kotlinx.serialization.Serializable

@Serializable
data class SaveGroupRequest(
    val name: String,
)

/** One of your friends, by the person id Social lists them under. */
@Serializable
data class InviteToGroupRequest(
    val personId: String,
)

/** Somebody in a group, or invited to one, as Social shows them. */
@Serializable
data class GroupMemberView(
    val username: String?,
    /** What you call them if they are your friend, their main character otherwise. */
    val name: String?,
    val spriteImgUrl: String?,
    val image: String?,
    val you: Boolean,
    /** On your friends list, which is what lets their characters be seated without an invite. */
    val friend: Boolean,
)

/** An invite to a group nobody has answered, cancellable by any member. */
@Serializable
data class GroupInviteeView(
    val id: String,
    val member: GroupMemberView,
)

/** A friend of yours who is friends with every member, so may be invited. */
@Serializable
data class InvitableFriendView(
    val personId: String,
    val name: String,
)

@Serializable
data class GroupView(
    val id: String,
    val name: String,
    val members: List<GroupMemberView>,
    val invited: List<GroupInviteeView>,
    val invitable: List<InvitableFriendView>,
)

/** A new party's roster from a group: GET /api/groups/{id}/roster. */
@Serializable
data class GroupRosterResponse(
    /** One character of each groupmate's, to seat beside yours. */
    val members: List<String>,
    /** Groupmates left out, as you call them: no character free for the boss, or not your friend. */
    val missing: List<String>,
)

/** An invite to one of your accounts, waiting on you. */
@Serializable
data class IncomingGroupInviteView(
    val id: String,
    val group: String,
    /** Who invited you, as the bell names them. */
    val from: String?,
    val members: Int,
)

@Serializable
data class GroupsResponse(
    val groups: List<GroupView>,
    val invites: List<IncomingGroupInviteView>,
)
