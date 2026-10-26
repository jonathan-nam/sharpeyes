package com.sharpeyes.backend.groups

import com.sharpeyes.backend.db.FriendGroup
import com.sharpeyes.backend.db.FriendGroupMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Who is in which group. Inside a transaction, like the rest. See Groups.kt.

/** Every account [userId] shares a group with, not counting themselves. */
internal fun groupmatesOf(userId: String): Set<String> {
    val groups = groupsOf(userId)
    if (groups.isEmpty()) return emptySet()
    return FriendGroupMember
        .selectAll()
        .where { (FriendGroupMember.groupId inList groups) and (FriendGroupMember.userId neq userId) }
        .mapTo(mutableSetOf()) { it[FriendGroupMember.userId] }
}

internal fun groupsOf(userId: String): List<Uuid> =
    FriendGroupMember
        .selectAll()
        .where { FriendGroupMember.userId eq userId }
        .map { it[FriendGroupMember.groupId] }

internal fun membersOf(groupId: Uuid): List<String> =
    FriendGroupMember
        .selectAll()
        .where { FriendGroupMember.groupId eq groupId }
        .map { it[FriendGroupMember.userId] }

internal fun isMember(
    groupId: Uuid,
    userId: String,
) = userId in membersOf(groupId)

internal fun groupName(groupId: Uuid): String =
    FriendGroup
        .selectAll()
        .where { FriendGroup.id eq groupId }
        .first()[FriendGroup.name]
