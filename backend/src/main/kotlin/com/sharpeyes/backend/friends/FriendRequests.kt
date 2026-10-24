package com.sharpeyes.backend.friends

import com.sharpeyes.backend.db.FriendRequest
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import com.sharpeyes.backend.parties.unlinkPerson
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Two accounts finding each other by Discord username. A friend is a linked person on both sides,
// the same link an invite writes (person.linked_user_id), so everything shared already reads it.
// Inside a transaction, like the rest.

/**
 * Asks [username]'s account to be friends. With [person], it is a request to link that person of
 * [from]'s (sent from People), and accepting links them rather than a guessed one.
 */
internal fun sendFriendRequest(
    from: String,
    username: String,
    now: Instant,
    person: Uuid? = null,
): SendOutcome {
    val to = accountNamed(username)
    val theirs =
        to?.let {
            FriendRequest
                .selectAll()
                .where { (FriendRequest.fromUserId eq it) and (FriendRequest.toUserId eq from) }
                .firstOrNull()
        }
    return personProblem(from, person) ?: when {
        to == null -> SendOutcome.Unknown
        to == from -> SendOutcome.Yourself
        linkedTo(from, to) -> SendOutcome.AlreadyFriends
        theirs != null -> {
            acceptFriendRequest(from, theirs[FriendRequest.id], now, person)
            SendOutcome.Accepted
        }
        else -> {
            ask(from, to, now, person)
            SendOutcome.Sent
        }
    }
}

/** Why [person] cannot be named on a request from [owner], or null when it can (or none was). */
private fun personProblem(
    owner: String,
    person: Uuid?,
): SendOutcome? {
    val row =
        person?.let {
            Person
                .selectAll()
                .where { (Person.id eq it) and (Person.userId eq owner) }
                .firstOrNull()
        }
    return when {
        person == null -> null
        row == null -> SendOutcome.NoSuchPerson
        row[Person.linkedUserId] != null -> SendOutcome.PersonLinked
        else -> null
    }
}

private fun ask(
    from: String,
    to: String,
    now: Instant,
    person: Uuid?,
) {
    if (person != null) {
        // A person waits on one account at a time, so asking another replaces the first.
        FriendRequest
            .selectAll()
            .where {
                (FriendRequest.fromUserId eq from) and (FriendRequest.personId eq person) and
                    (FriendRequest.toUserId neq to)
            }.forEach { dropFriendRequest(from, it[FriendRequest.id]) }
    }
    val id = Uuid.random()
    val inserted =
        FriendRequest
            .insertIgnore {
                it[FriendRequest.id] = id
                it[fromUserId] = from
                it[toUserId] = to
                it[createdAt] = now
                it[personId] = person
            }.insertedCount > 0
    // Asking twice is one request, and one notification. A person named the second time still counts.
    if (inserted) {
        notify(to, NotificationKind.FRIEND_REQUEST, now, subjectId = id, actorId = from)
    } else if (person != null) {
        FriendRequest.update({ (FriendRequest.fromUserId eq from) and (FriendRequest.toUserId eq to) }) {
            it[personId] = person
        }
    }
}

/**
 * Accepts a request made TO [userId]. False when there is no such request.
 *
 * [person] is which of [userId]'s people the sender is, when the answer came from People.
 */
internal fun acceptFriendRequest(
    userId: String,
    requestId: Uuid,
    now: Instant,
    person: Uuid? = null,
): Boolean {
    val request =
        FriendRequest
            .selectAll()
            .where { (FriendRequest.id eq requestId) and (FriendRequest.toUserId eq userId) }
            .firstOrNull() ?: return false
    val from = request[FriendRequest.fromUserId]
    // Both directions: a request each way is one friendship, and neither is still waiting. Each
    // keeps the person its sender named.
    val both = FriendRequest.selectAll().where { between(from, userId) }.toList()
    val pins = both.associate { it[FriendRequest.fromUserId] to it[FriendRequest.personId] }
    FriendRequest.deleteWhere { between(from, userId) }
    resolve(NotificationKind.FRIEND_REQUEST, both.map { it[FriendRequest.id] })
    notify(from, NotificationKind.FRIEND_ACCEPTED, now, actorId = userId)
    linkSide(from, userId, now, pins[from])
    linkSide(userId, from, now, person ?: pins[userId])
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

/** Ends a friendship from both sides, seats included. False when [personId] is not a friend of yours. */
internal fun removeFriend(
    userId: String,
    personId: Uuid,
): Boolean {
    val linked =
        Person
            .selectAll()
            .where { (Person.id eq personId) and (Person.userId eq userId) }
            .firstOrNull()
            ?.get(Person.linkedUserId) != null
    return linked && unlinkPerson(userId, personId)
}

private fun between(
    a: String,
    b: String,
) = ((FriendRequest.fromUserId eq a) and (FriendRequest.toUserId eq b)) or
    ((FriendRequest.fromUserId eq b) and (FriendRequest.toUserId eq a))
