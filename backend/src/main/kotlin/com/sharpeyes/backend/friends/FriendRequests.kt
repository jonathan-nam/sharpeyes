package com.sharpeyes.backend.friends

import com.sharpeyes.backend.db.FriendRequest
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import com.sharpeyes.backend.parties.unlinkPerson
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Two accounts finding each other by Discord username. A friend is a linked person on both sides,
// the same link an invite writes (person.linked_user_id), so everything shared already reads it.
// Inside a transaction, like the rest.

internal fun sendFriendRequest(
    from: String,
    username: String,
    now: Instant,
): SendOutcome {
    val to = accountNamed(username) ?: return SendOutcome.Unknown
    val theirs =
        FriendRequest
            .selectAll()
            .where { (FriendRequest.fromUserId eq to) and (FriendRequest.toUserId eq from) }
            .firstOrNull()
    return when {
        to == from -> SendOutcome.Yourself
        linkedTo(from, to) -> SendOutcome.AlreadyFriends
        theirs != null -> {
            acceptFriendRequest(from, theirs[FriendRequest.id], now)
            SendOutcome.Accepted
        }
        else -> {
            val id = Uuid.random()
            val inserted =
                FriendRequest
                    .insertIgnore {
                        it[FriendRequest.id] = id
                        it[fromUserId] = from
                        it[toUserId] = to
                        it[createdAt] = now
                    }.insertedCount > 0
            // Asking twice is one request, and one notification.
            if (inserted) notify(to, NotificationKind.FRIEND_REQUEST, now, subjectId = id, actorId = from)
            SendOutcome.Sent
        }
    }
}

/** Accepts a request made TO [userId]. False when there is no such request. */
internal fun acceptFriendRequest(
    userId: String,
    requestId: Uuid,
    now: Instant,
): Boolean {
    val request =
        FriendRequest
            .selectAll()
            .where { (FriendRequest.id eq requestId) and (FriendRequest.toUserId eq userId) }
            .firstOrNull() ?: return false
    val from = request[FriendRequest.fromUserId]
    // Both directions: a request each way is one friendship, and neither is still waiting.
    val answered = FriendRequest.selectAll().where { between(from, userId) }.map { it[FriendRequest.id] }
    FriendRequest.deleteWhere { between(from, userId) }
    resolve(NotificationKind.FRIEND_REQUEST, answered)
    notify(from, NotificationKind.FRIEND_ACCEPTED, now, actorId = userId)
    linkSide(from, userId, now)
    linkSide(userId, from, now)
    seatCharacters(from)
    seatCharacters(userId)
    return true
}

/** Declines a request to [userId], or cancels one from them. False when it is neither. */
internal fun dropFriendRequest(
    userId: String,
    requestId: Uuid,
): Boolean {
    val dropped =
        FriendRequest.deleteWhere {
            (FriendRequest.id eq requestId) and
                ((FriendRequest.toUserId eq userId) or (FriendRequest.fromUserId eq userId))
        } > 0
    if (dropped) resolve(NotificationKind.FRIEND_REQUEST, listOf(requestId))
    return dropped
}

/**
 * Ends a friendship from both sides, seats included. False when [personId] is not a friend of yours.
 *
 * Both, unlike Unlink on People: a friendship is the two of you agreeing, so one side ending it ends
 * it for both. unlinkPerson is what takes the seats back on each side.
 */
internal fun removeFriend(
    userId: String,
    personId: Uuid,
): Boolean {
    val friend =
        Person
            .selectAll()
            .where { (Person.id eq personId) and (Person.userId eq userId) }
            .firstOrNull()
            ?.get(Person.linkedUserId) ?: return false
    unlinkPerson(userId, personId)
    Person
        .selectAll()
        .where { (Person.userId eq friend) and (Person.linkedUserId eq userId) }
        .map { it[Person.id] }
        .forEach { unlinkPerson(friend, it) }
    return true
}

private fun between(
    a: String,
    b: String,
) = ((FriendRequest.fromUserId eq a) and (FriendRequest.toUserId eq b)) or
    ((FriendRequest.fromUserId eq b) and (FriendRequest.toUserId eq a))
