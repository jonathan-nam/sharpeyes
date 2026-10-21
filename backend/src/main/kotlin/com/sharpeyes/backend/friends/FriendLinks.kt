package com.sharpeyes.backend.friends

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.invites.seatInLinkedParties
import com.sharpeyes.backend.invites.senderNameFor
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Writing a friendship: the same person.linked_user_id an invite writes, on both sides. See FriendRequests.kt.

internal fun linkedTo(
    owner: String,
    other: String,
) = !Person
    .selectAll()
    .where { (Person.userId eq owner) and (Person.linkedUserId eq other) }
    .empty()

/**
 * Links [other]'s account to a person on [owner]'s list, making one if none is clearly them.
 *
 * Clearly them is the ONE unlinked person [owner] has filed any of [other]'s characters under. Two
 * such people is a question only [owner] can answer, so neither is picked and a new person is made:
 * People then shows the overlap rather than this guessing which one was right.
 */
internal fun linkSide(
    owner: String,
    other: String,
    now: Instant,
) {
    if (linkedTo(owner, other)) return
    val theirs =
        Characters
            .selectAll()
            .where { Characters.userId eq other }
            .mapTo(mutableSetOf()) { it[Characters.name].lowercase() }
    val unlinked =
        Person
            .selectAll()
            .where { (Person.userId eq owner) and Person.linkedUserId.isNull() }
            .associate { it[Person.id] to it[Person.name] }
    val filed =
        PersonCharacter
            .selectAll()
            .where { (PersonCharacter.userId eq owner) and (PersonCharacter.personId inList unlinked.keys) }
            .filter { it[PersonCharacter.name].lowercase() in theirs }
            .mapTo(mutableSetOf()) { it[PersonCharacter.personId] }
    val name = senderNameFor(other) ?: discordUsernameOf(other) ?: "Friend"
    val person =
        filed.singleOrNull()
            ?: unlinked.entries
                .firstOrNull { it.value.equals(name, ignoreCase = true) }
                ?.key
                .takeIf { filed.isEmpty() }
            ?: newPerson(owner, freeName(owner, listOfNotNull(name, discordUsernameOf(other))), now)
    Person.update({ Person.id eq person }) {
        it[linkedUserId] = other
        it[updatedAt] = now
    }
}

private fun newPerson(
    owner: String,
    name: String,
    now: Instant,
): Uuid {
    val id = Uuid.random()
    Person.insert {
        it[Person.id] = id
        it[userId] = owner
        it[Person.name] = name
        it[pinned] = false
        it[createdAt] = now
        it[updatedAt] = now
    }
    return id
}

/** The first of [wanted] not already a person of [owner]'s, numbered if all are. */
private fun freeName(
    owner: String,
    wanted: List<String>,
): String {
    val taken =
        Person
            .selectAll()
            .where { Person.userId eq owner }
            .mapTo(mutableSetOf()) { it[Person.name].lowercase() }
    return wanted.firstOrNull { it.lowercase() !in taken }
        ?: generateSequence(2) { it + 1 }.map { "${wanted.first()} $it" }.first { it.lowercase() !in taken }
}

/** Binds every seat that already names one of [userId]'s characters, in parties of accounts linked to them. */
internal fun seatCharacters(userId: String) {
    Characters
        .selectAll()
        .where { Characters.userId eq userId }
        .forEach {
            seatInLinkedParties(userId, it[Characters.id], it[Characters.name], it[Characters.worldType])
        }
}
