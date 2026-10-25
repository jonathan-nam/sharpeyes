package com.sharpeyes.backend.friends

import com.sharpeyes.api.friends.DiscordLookupResponse
import com.sharpeyes.api.friends.FriendView
import com.sharpeyes.api.friends.SocialResponse
import com.sharpeyes.backend.db.FriendRequest
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.parties.imageOf
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
    return FriendView(id.toString(), discordUsernameOf(account), name ?: main, sprite, imageOf(account))
}

private fun requests(
    mine: Column<String>,
    userId: String,
) = FriendRequest
    .selectAll()
    .where { mine eq userId }
    .orderBy(FriendRequest.createdAt, SortOrder.DESC)

/**
 * The account a typed Discord username is, as a request to it would show it, so the sender sees who
 * they are about to ask. Null when nobody here has the name. Discord shows the same face to anyone
 * who types the name, so this tells nothing Discord does not.
 */
internal fun lookupFor(
    userId: String,
    username: String,
): DiscordLookupResponse? {
    val account = accountNamed(username) ?: return null
    val (main, sprite) = faceOf(account)
    return DiscordLookupResponse(
        username = discordUsernameOf(account) ?: username.trim().removePrefix("@"),
        image = imageOf(account),
        name = main,
        spriteImgUrl = sprite,
        you = account == userId,
    )
}

/** Must be called from inside a `transaction { }` block. */
internal fun socialFor(userId: String): SocialResponse {
    val names = Person.selectAll().where { Person.userId eq userId }.associate { it[Person.id] to it[Person.name] }
    val sent = requests(FriendRequest.fromUserId, userId)
    val received = requests(FriendRequest.toUserId, userId)
    return SocialResponse(
        username = discordUsernameOf(userId),
        friends = friendsOf(userId).map { (person, account) -> view(person, account, names[person]) },
        outgoing = sent.map { view(it[FriendRequest.id], it[FriendRequest.toUserId]) },
        incoming = received.map { view(it[FriendRequest.id], it[FriendRequest.fromUserId]) },
    )
}
