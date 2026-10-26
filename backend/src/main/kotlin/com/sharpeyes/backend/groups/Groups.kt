package com.sharpeyes.backend.groups

import com.sharpeyes.api.system.Refusal
import com.sharpeyes.backend.db.FriendGroup
import com.sharpeyes.backend.db.FriendGroupInvite
import com.sharpeyes.backend.db.FriendGroupMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publish
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Groups: people who seat each other's characters without a party invite. Joining is by invite, and
// only a friend can be invited. Nobody owns a group: any member invites, renames or leaves, and the
// last one out deletes it. Inside a transaction, like the rest. See V102__friend_groups.sql.

internal const val MAX_GROUP_NAME = 40

/** What a group write came to. */
internal sealed interface GroupAnswer {
    data object Done : GroupAnswer

    data object NotFound : GroupAnswer

    data class Refused(
        val refusal: Refusal,
    ) : GroupAnswer
}

private fun nameRefusal(name: String): Refusal? =
    when {
        name.isBlank() -> Refusal("The group has no name. Add one.")
        name.length > MAX_GROUP_NAME -> Refusal("That name is too long. Keep it to $MAX_GROUP_NAME characters.")
        else -> null
    }

/** Makes a group with [userId] in it. */
internal fun createGroup(
    userId: String,
    name: String,
    now: Instant,
): GroupAnswer {
    val trimmed = name.trim()
    nameRefusal(trimmed)?.let { return GroupAnswer.Refused(it) }
    val id = Uuid.random()
    FriendGroup.insert {
        it[FriendGroup.id] = id
        it[FriendGroup.name] = trimmed
        it[createdAt] = now
    }
    FriendGroupMember.insert {
        it[groupId] = id
        it[FriendGroupMember.userId] = userId
        it[joinedAt] = now
    }
    return GroupAnswer.Done
}

/**
 * Invites the account [userId] calls [personId] into [groupId].
 *
 * Only somebody who is friends with every member: a group seats characters, and a character is only
 * ever bound to a seat through a friendship (person.linked_user_id). A friend of one member only
 * would be a groupmate whose characters the others could not seat.
 */
internal fun inviteToGroup(
    userId: String,
    groupId: Uuid,
    personId: Uuid,
    now: Instant,
): GroupAnswer {
    val friend =
        Person
            .selectAll()
            .where { (Person.id eq personId) and (Person.userId eq userId) }
            .firstOrNull()
            ?.get(Person.linkedUserId)
    return when {
        friend == null || !isMember(groupId, userId) -> GroupAnswer.NotFound
        isMember(groupId, friend) -> GroupAnswer.Refused(Refusal("They're already in this group."))
        !friendsWithEveryone(friend, groupId) -> GroupAnswer.Refused(NOT_FRIENDS_WITH_EVERYONE)
        else -> {
            sendGroupInvite(userId, groupId, friend, now)
            GroupAnswer.Done
        }
    }
}

private fun sendGroupInvite(
    userId: String,
    groupId: Uuid,
    friend: String,
    now: Instant,
) {
    val id = Uuid.random()
    val inserted =
        FriendGroupInvite
            .insertIgnore {
                it[FriendGroupInvite.id] = id
                it[FriendGroupInvite.groupId] = groupId
                it[FriendGroupInvite.userId] = friend
                it[invitedBy] = userId
                it[createdAt] = now
            }.insertedCount > 0
    // Inviting twice is one invite, and one notification.
    if (inserted) {
        val payload =
            buildJsonObject {
                put("groupId", groupId.toString())
                put("group", groupName(groupId))
            }
        notify(friend, NotificationKind.GROUP_INVITE, now, id, userId, payload)
    }
    publish(membersOf(groupId), Topic.FRIENDS)
}

private val NOT_FRIENDS_WITH_EVERYONE =
    Refusal("They aren't friends with everyone in this group. Ask them to add the others first.")

/**
 * Joins the group an invite to [userId] names, if they are still friends with every member. The
 * group can have changed since the invite was sent.
 */
internal fun acceptGroupInvite(
    userId: String,
    inviteId: Uuid,
    now: Instant,
): GroupAnswer {
    val groupId =
        FriendGroupInvite
            .selectAll()
            .where { (FriendGroupInvite.id eq inviteId) and (FriendGroupInvite.userId eq userId) }
            .firstOrNull()
            ?.get(FriendGroupInvite.groupId)
    if (groupId != null) dropInvite(inviteId)
    return when {
        groupId == null -> GroupAnswer.NotFound
        !friendsWithEveryone(userId, groupId) ->
            GroupAnswer.Refused(Refusal("You aren't friends with everyone in this group. Ask for a new invite."))
        else -> {
            FriendGroupMember.insertIgnore {
                it[FriendGroupMember.groupId] = groupId
                it[FriendGroupMember.userId] = userId
                it[joinedAt] = now
            }
            publish(membersOf(groupId), Topic.FRIENDS)
            GroupAnswer.Done
        }
    }
}

/** Declined by the invitee, or withdrawn by any member of the group. */
internal fun dropGroupInvite(
    userId: String,
    inviteId: Uuid,
): GroupAnswer {
    val invite =
        FriendGroupInvite
            .selectAll()
            .where { FriendGroupInvite.id eq inviteId }
            .firstOrNull()
    val groupId = invite?.get(FriendGroupInvite.groupId)
    val invitee = invite?.get(FriendGroupInvite.userId)
    return if (groupId == null || (invitee != userId && !isMember(groupId, userId))) {
        GroupAnswer.NotFound
    } else {
        dropInvite(inviteId)
        publish(membersOf(groupId) + listOfNotNull(invitee), Topic.FRIENDS)
        GroupAnswer.Done
    }
}

private fun dropInvite(inviteId: Uuid) {
    FriendGroupInvite.deleteWhere { FriendGroupInvite.id eq inviteId }
    resolve(NotificationKind.GROUP_INVITE, listOf(inviteId))
}

/**
 * Takes [userId] out of [groupId], and deletes it when nobody is left.
 *
 * Seats already bound stay bound: leaving a group stops the next party from seating you without an
 * invite, it does not take you out of the ones you are in. Leave those the usual way.
 */
internal fun leaveGroup(
    userId: String,
    groupId: Uuid,
): GroupAnswer {
    if (!isMember(groupId, userId)) return GroupAnswer.NotFound
    FriendGroupMember.deleteWhere { (FriendGroupMember.groupId eq groupId) and (FriendGroupMember.userId eq userId) }
    val left = membersOf(groupId)
    if (left.isEmpty()) {
        val invites =
            FriendGroupInvite
                .selectAll()
                .where { FriendGroupInvite.groupId eq groupId }
                .map { it[FriendGroupInvite.id] }
        resolve(NotificationKind.GROUP_INVITE, invites)
        FriendGroup.deleteWhere { FriendGroup.id eq groupId }
    }
    publish(left + userId, Topic.FRIENDS)
    return GroupAnswer.Done
}
