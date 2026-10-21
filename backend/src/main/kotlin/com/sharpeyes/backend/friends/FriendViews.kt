package com.sharpeyes.backend.friends

import com.sharpeyes.backend.db.FriendRequest
import com.sharpeyes.backend.db.Person
import org.jetbrains.exposed.v1.core.Column
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// What Social reads. Inside a transaction, like the rest.

/** Another account as Social shows it. */
private fun view(
    id: Uuid,
    account: String,
    name: String? = null,
): FriendView {
    val (main, sprite) = faceOf(account)
    return FriendView(id.toString(), discordUsernameOf(account), name ?: main, sprite)
}

private fun requests(
    mine: Column<String>,
    userId: String,
) = FriendRequest
    .selectAll()
    .where { mine eq userId }
    .orderBy(FriendRequest.createdAt, SortOrder.DESC)

/** Must be called from inside a `transaction { }` block. */
internal fun socialFor(userId: String): SocialResponse {
    val names = Person.selectAll().where { Person.userId eq userId }.associate { it[Person.id] to it[Person.name] }
    val sent = requests(FriendRequest.fromUserId, userId)
    return SocialResponse(
        username = discordUsernameOf(userId),
        friends = friendsOf(userId).map { (person, account) -> view(person, account, names[person]) },
        outgoing = sent.map { view(it[FriendRequest.id], it[FriendRequest.toUserId]) },
    )
}
