package com.sharpeyes.backend.groups

import com.sharpeyes.api.groups.GroupInviteeView
import com.sharpeyes.api.groups.GroupMemberView
import com.sharpeyes.api.groups.GroupView
import com.sharpeyes.api.groups.GroupsResponse
import com.sharpeyes.api.groups.IncomingGroupInviteView
import com.sharpeyes.backend.db.FriendGroup
import com.sharpeyes.backend.db.FriendGroupInvite
import com.sharpeyes.backend.db.FriendGroupMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.friends.discordUsernameOf
import com.sharpeyes.backend.friends.faceOf
import com.sharpeyes.backend.parties.imageOf
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll

// What the Groups page reads. Inside a transaction, like the rest.

/** Your groups, oldest first, and the invites waiting on you. */
internal fun groupsFor(userId: String): GroupsResponse {
    val friends =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .associate { it[Person.linkedUserId]!! to it[Person.name] }
    val face = { account: String -> memberView(account, userId, friends[account]) }
    val ids = groupsOf(userId)
    val groups =
        FriendGroup
            .selectAll()
            .where { FriendGroup.id inList ids }
            .orderBy(FriendGroup.createdAt, SortOrder.ASC)
            .map { row ->
                val id = row[FriendGroup.id]
                val members =
                    FriendGroupMember
                        .selectAll()
                        .where { FriendGroupMember.groupId eq id }
                        .orderBy(FriendGroupMember.joinedAt, SortOrder.ASC)
                        .map { face(it[FriendGroupMember.userId]) }
                val invited =
                    FriendGroupInvite
                        .selectAll()
                        .where { FriendGroupInvite.groupId eq id }
                        .orderBy(FriendGroupInvite.createdAt, SortOrder.ASC)
                        .map {
                            GroupInviteeView(
                                it[FriendGroupInvite.id].toString(),
                                face(it[FriendGroupInvite.userId]),
                            )
                        }
                GroupView(id.toString(), row[FriendGroup.name], members, invited)
            }
    val invites =
        FriendGroupInvite
            .innerJoin(FriendGroup)
            .selectAll()
            .where { FriendGroupInvite.userId eq userId }
            .orderBy(FriendGroupInvite.createdAt, SortOrder.DESC)
            .map { row ->
                val from = row[FriendGroupInvite.invitedBy]
                IncomingGroupInviteView(
                    id = row[FriendGroupInvite.id].toString(),
                    group = row[FriendGroup.name],
                    from = faceOf(from).first ?: discordUsernameOf(from),
                    members = membersOf(row[FriendGroup.id]).size,
                )
            }
    return GroupsResponse(groups, invites)
}

private fun memberView(
    account: String,
    viewer: String,
    friendName: String?,
): GroupMemberView {
    val (main, sprite) = faceOf(account)
    return GroupMemberView(
        username = discordUsernameOf(account),
        name = friendName ?: main,
        spriteImgUrl = sprite,
        image = imageOf(account),
        you = account == viewer,
        friend = friendName != null,
    )
}
