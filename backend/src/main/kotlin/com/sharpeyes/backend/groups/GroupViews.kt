package com.sharpeyes.backend.groups

import com.sharpeyes.api.groups.GroupInviteeView
import com.sharpeyes.api.groups.GroupMemberView
import com.sharpeyes.api.groups.GroupView
import com.sharpeyes.api.groups.GroupsResponse
import com.sharpeyes.api.groups.IncomingGroupInviteView
import com.sharpeyes.api.groups.InvitableFriendView
import com.sharpeyes.backend.db.FriendGroup
import com.sharpeyes.backend.db.FriendGroupInvite
import com.sharpeyes.backend.db.FriendGroupMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.friends.discordUsernameOf
import com.sharpeyes.backend.friends.faceOf
import com.sharpeyes.backend.parties.imageOf
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll

// What the Groups page reads. Inside a transaction, like the rest.

/** Your groups, oldest first, and the invites waiting on you. */
internal fun groupsFor(userId: String): GroupsResponse {
    val people =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .toList()
    val friends = people.associate { it[Person.linkedUserId]!! to it[Person.name] }
    val face = { account: String -> memberView(account, userId, friends[account]) }
    val ids = groupsOf(userId)
    val groups =
        FriendGroup
            .selectAll()
            .where { FriendGroup.id inList ids }
            .orderBy(FriendGroup.createdAt, SortOrder.ASC)
            .map { groupView(it, people, face) }
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

/** One group: its members, its pending invites, and which of [people] (your friends) may be invited. */
private fun groupView(
    row: ResultRow,
    people: List<ResultRow>,
    face: (String) -> GroupMemberView,
): GroupView {
    val id = row[FriendGroup.id]
    val accounts =
        FriendGroupMember
            .selectAll()
            .where { FriendGroupMember.groupId eq id }
            .orderBy(FriendGroupMember.joinedAt, SortOrder.ASC)
            .map { it[FriendGroupMember.userId] }
    val pending =
        FriendGroupInvite
            .selectAll()
            .where { FriendGroupInvite.groupId eq id }
            .orderBy(FriendGroupInvite.createdAt, SortOrder.ASC)
            .toList()
    val taken = accounts.toSet() + pending.map { it[FriendGroupInvite.userId] }
    // The rule inviteToGroup enforces, as the picker's list, so it is never met as an error.
    val invitable =
        people
            .filter { friend ->
                val account = friend[Person.linkedUserId]!!
                account !in taken && friendsWithEveryone(account, id)
            }.map { InvitableFriendView(it[Person.id].toString(), it[Person.name]) }
    val invited =
        pending.map { p -> GroupInviteeView(p[FriendGroupInvite.id].toString(), face(p[FriendGroupInvite.userId])) }
    return GroupView(id.toString(), row[FriendGroup.name], accounts.map(face), invited, invitable)
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
