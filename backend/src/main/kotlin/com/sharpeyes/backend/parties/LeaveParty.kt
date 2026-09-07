package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Leaving a party you are in but do not own.
//
// The first write that crosses accounts, and it is the safe one because its subject is entirely the
// caller: it takes their seat out of the roster and their account off that seat. Everything else a
// member might write goes into somebody else's POOL, where two people logging one night is a double
// count with nothing on screen saying so. See SeatedParties.kt, which is the read this mirrors.
// Inside a transaction, like the rest.

/**
 * Takes every seat of [userId]'s out of [partyId], and their account off those seats.
 *
 * Authorised the way partiesSeatedIn is, and for the same reason: you reach the party by owning a
 * character with a standing seat in it. Returns false when you own none, which the caller answers
 * as a 404, so asking to leave a party you are not in teaches nothing about whether it exists.
 *
 * The roster edit is the OWNER'S, run through writeMembers rather than written here, so a member
 * leaving and an owner removing them land the same rows. What that buys, in their own words:
 * pinWeeksAlreadyWritten freezes the roster onto every week already written into, so a night
 * already played keeps you on it and keeps what it owes you, and retireOrDelete retires a seat a
 * payout or a past week points at instead of deleting it. Leaving lands from the first week nobody
 * has written into.
 *
 * The shares of everybody staying are read and handed back in. writeMembers reads a name it was not
 * given a share for as taking one, so leaving a party where somebody carries would otherwise re-cut
 * the split for the people still in it.
 *
 * Nobody else left is #585's rule unchanged: the config demotes to the solo pool it now is, holding
 * every drop it already had, rather than becoming a party of one.
 */
internal fun leaveParty(
    userId: String,
    partyId: Uuid,
    now: Instant,
): Boolean {
    val party = Party.selectAll().where { Party.id eq partyId }.firstOrNull()
    val mySeats = party?.let { seatsHeldIn(userId, partyId, it) }.orEmpty()
    if (party == null || mySeats.isEmpty()) return false

    val owner = party[Party.userId]
    val ownCharacterId = party[Party.characterId]
    val leaving = mySeats.map { (_, name) -> name.lowercase() }.toSet()
    val staying =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
            .map { it[PartyMember.name] to it[PartyMember.shares] }
            .filterNot { (name, _) -> name.lowercase() in leaving }

    // The owner's own seat is writeMembers' to add, so it is taken out of what is passed in and
    // left in the shares: absent from that map it would go back to taking one.
    val ownName = ownSeatName(ownCharacterId)
    val others = staying.map { (name, _) -> name }.filterNot { it.equals(ownName, ignoreCase = true) }
    val shares = staying.associate { (name, seatShares) -> name to seatShares }
    if (others.isEmpty()) {
        soloAgain(owner, partyId, ownCharacterId, bossResetOf(bossIdOfParty(partyId)!!)!!, now)
    } else {
        writeMembers(partyId, ownCharacterId, others, SeatContext(owner, emptyMap(), now), shares)
    }

    val seatIds = mySeats.map { (id, _) -> id }
    // A seat a payout points at is retired and not deleted, so the account has to be taken off it
    // by hand. Leaving it bound would leave the party readable by the person who just left it,
    // which is the same failure unlinkPerson exists to avoid from the other end.
    PartyMember.update({ PartyMember.id inList seatIds }) { it[linkedCharacterId] = null }
    // "If the seat leaves the party the designation lapses", which is V36's own reading of its ON
    // DELETE SET NULL. A retired seat is not deleted, so nothing in SQL fires and it is said here.
    val lapses = seatIds.any { it == party[Party.looterMemberId] }
    Party.update({ Party.id eq partyId }) {
        if (lapses) it[looterMemberId] = null
        it[updatedAt] = now
    }
    return true
}

/**
 * The caller's own standing seats in [party], and empty when it is not theirs to leave.
 *
 * Every world, not just the one being shown. A seat binds to a character and not to a world, so
 * narrowing here would refuse a leave for a party the caller really is in.
 */
private fun seatsHeldIn(
    userId: String,
    partyId: Uuid,
    party: ResultRow,
): List<Pair<Uuid, String>> {
    // Your own config is not a party you can leave. That would be deleting it with the pool still
    // hanging off it, and DELETE /api/parties/{id} is already that door, which retires rather than
    // destroys.
    if (party[Party.userId] == userId) return emptyList()
    val myCharacters =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .map { it[Characters.id] }
    return if (myCharacters.isEmpty()) {
        // Guarded rather than queried on an empty list, which is a WHERE matching nothing dressed
        // up as a question. partiesSeatedIn does the same.
        emptyList()
    } else {
        PartyMember
            .selectAll()
            .where {
                (PartyMember.partyId eq partyId) and
                    (PartyMember.linkedCharacterId inList myCharacters) and
                    (PartyMember.standing eq true)
            }.map { it[PartyMember.id] to it[PartyMember.name] }
    }
}

/**
 * POST /api/parties/{id}/leave. The party is somebody else's, and you are taking your seat out.
 *
 * Here rather than in PartyRoutes.kt, next to the rule it runs, the way listSeatedParties is: these
 * two are the only handlers in the app that answer for a party the caller does not own, and it is
 * worth being able to read the route and the authorisation together.
 *
 * 404 covers both "no such party" and "not one of yours to leave", because the caller is owed the
 * same answer for each: a party you have no seat in is one you cannot learn anything about.
 */
internal suspend fun RoutingContext.leavePartyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val left =
        transaction {
            ensureUser(userId, email)
            leaveParty(userId, partyId, Clock.System.now())
        }
    if (left) call.respond(HttpStatusCode.NoContent) else call.respond(HttpStatusCode.NotFound)
}
