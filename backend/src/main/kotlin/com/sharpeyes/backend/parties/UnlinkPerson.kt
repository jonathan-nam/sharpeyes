package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Taking back the account behind a person.
//
// A sign-on link is a bearer token: it says so itself, "the link IS the authority", and whoever
// holds the URL redeems it. Five minutes and one use is most of the answer to that, but not all of
// it, because until this there was NO way back. Nothing in the codebase cleared linked_user_id, so
// a link that reached the wrong person was permanent and needed hand-written SQL.
// Inside a transaction, like the rest.

/**
 * Takes the account off [personId], and takes their seats back with it.
 *
 * The seats are the point. partiesSeatedIn authorises on party_member.linked_character_id and not
 * on person.linked_user_id, so clearing the person alone would leave every seat still bound and the
 * other account still reading the party, its roster, its nights and what they sold for. An unlink
 * that does not revoke is worse than none, because it looks like it worked.
 *
 * Only seats on YOUR OWN parties. A seat of theirs on somebody else's config is that person's
 * business and not reachable from here.
 *
 * The person stays, with whatever this account attributed to them by hand. Unlinking says "that is
 * not their account", not "I do not know them": deleting the person would take the attributions
 * with it and a payout still points at the seats.
 *
 * Returns false when there is no such person of yours, which the caller answers as a 404.
 */
internal fun unlinkPerson(
    userId: String,
    personId: Uuid,
): Boolean {
    val person =
        Person
            .selectAll()
            .where { (Person.id eq personId) and (Person.userId eq userId) }
            .firstOrNull() ?: return false

    // Already unlinked is a success, not an error: the caller asked for a state and it is the
    // state. Guarded rather than returned early, detekt allowing one early return and the one
    // above being the answer worth having.
    val account = person[Person.linkedUserId]
    if (account != null) {
        revokeSeats(userId, account)
        Person.update({ Person.id eq personId }) {
            it[linkedUserId] = null
            it[updatedAt] = Clock.System.now()
        }
    }
    return true
}

/**
 * Takes back every seat on YOUR parties that points at a character of [account]'s.
 *
 * The half of unlinking that actually revokes. A seat of theirs on somebody ELSE'S config is that
 * person's business and not reachable from here.
 */
private fun revokeSeats(
    userId: String,
    account: String,
) {
    val theirCharacters =
        Characters
            .selectAll()
            .where { Characters.userId eq account }
            .map { it[Characters.id] }
    if (theirCharacters.isNotEmpty()) {
        val myParties =
            Party
                .selectAll()
                .where { Party.userId eq userId }
                .map { it[Party.id] }
        if (myParties.isNotEmpty()) {
            PartyMember.update({
                (PartyMember.partyId inList myParties) and
                    (PartyMember.linkedCharacterId inList theirCharacters)
            }) { it[linkedCharacterId] = null }
        }
    }
}
