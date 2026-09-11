package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.inActiveWorld
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.alias
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// The parties somebody else owns that one of YOUR characters sits in.
//
// A second door, deliberately, rather than widening partiesFor. That function is what every party
// screen reads and it carries loot counts with it, so relaxing its ownership filter would put
// somebody else's pool in front of every existing caller at once. The dangerous half of a shared
// party is the crossing itself, so it happens in one place that does nothing else.
// Must be called from inside a `transaction { }` block.

/**
 * Every party of somebody else's that a character of yours is seated in.
 *
 * The authorisation rule IS the roster: you reach a party by owning a character with a seat in it,
 * and the seat states that as a foreign key rather than by matching a name. Failing closed is the
 * point. A seat that merely names your character gets you nothing, because binding happens only
 * where an invite was accepted. See V75 and InviteAccept.takeSeats.
 *
 * Narrowed to the world being shown, like every account-wide read, and to standing seats: a seat
 * you have been retired out of is a party you have left.
 */
internal fun partiesSeatedIn(userId: String): List<SeatedPartyResponse> {
    val myCharacters =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and inActiveWorld(userId) }
            .map { it[Characters.id] }

    // Guarded rather than queried on an empty list, which is a WHERE that matches nothing dressed
    // up as a question.
    val mySeats =
        if (myCharacters.isEmpty()) {
            emptyList()
        } else {
            PartyMember
                .innerJoin(Party)
                .selectAll()
                .where {
                    (PartyMember.linkedCharacterId inList myCharacters) and
                        (PartyMember.standing eq true) and
                        // Never your own. Those are partiesFor's, with their pool and their money,
                        // and returning them here too would be two answers to one party.
                        (Party.userId neq userId)
                }.map { Seat(it[Party.id], it[PartyMember.id].toString(), it[PartyMember.linkedCharacterId]!!) }
        }
    if (mySeats.isEmpty()) return emptyList()

    val seatsByParty = mySeats.groupBy { it.partyId }
    val partyIds = seatsByParty.keys.toList()
    val rows =
        Party
            .innerJoin(BossCatalog)
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { Party.id inList partyIds }
            .orderBy(BossCatalog.sortOrder)
            .toList()

    // Read as YOU, which is what makes the card the owner's party and the reading yours: whose
    // character each seat is comes off your own people list, and the clear answers for the
    // character of yours that sits in it.
    val parties =
        partiesFromRows(
            rows,
            userId,
            asCharacter = seatsByParty.mapValues { (_, seats) -> seats.first().characterId },
        )

    return parties.map { party ->
        val seats = seatsByParty[Uuid.parse(party.id)].orEmpty()
        SeatedPartyResponse(
            party = party,
            mySeatIds = seats.map { it.memberId },
            yourCharacterId = seats.first().characterId.toString(),
        )
    }
}

/** One seat of yours in somebody else's party. */
private data class Seat(
    val partyId: Uuid,
    val memberId: String,
    val characterId: Uuid,
)

/**
 * True when this user may READ the config: they own it, or they hold a seat in it.
 *
 * Deliberately not ownsParty's job. Every write stays on that one, because a pool with two
 * keyboards logs one night twice, which is the failure this repo exists to prevent.
 */
internal fun canReadParty(
    partyId: Uuid,
    userId: String,
): Boolean = ownsParty(partyId, userId) || isSeatedIn(partyId, userId)

/**
 * True when one of this account's characters holds a standing seat in [partyId].
 *
 * The same rule partiesSeatedIn is built on, asked about one party: you reach a party by owning a
 * character whose seat states so as a foreign key. It says what may be READ and never what may be
 * written, because every write lands in the owner's pool. See ownsParty, which is the other half.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun isSeatedIn(
    partyId: Uuid,
    userId: String,
): Boolean = seatedCharacterIn(partyId, userId) != null

/**
 * The character of this account's that sits in [partyId], or null when none does.
 *
 * What a member's clear is read against: boss_clear is per CHARACTER, so the owner's tick answers
 * "have they run it" where a member's screen is asking "have I". The first seat by position when
 * two of your characters are in one party, which is the seat the party is filed under anyway.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun seatedCharacterIn(
    partyId: Uuid,
    userId: String,
): Uuid? {
    val theirCharacter = Characters.alias("seated_character")
    return PartyMember
        .join(theirCharacter, JoinType.INNER, PartyMember.linkedCharacterId, theirCharacter[Characters.id])
        .selectAll()
        .where {
            (PartyMember.partyId eq partyId) and
                (PartyMember.standing eq true) and
                (theirCharacter[Characters.userId] eq userId)
        }.orderBy(PartyMember.position)
        .firstOrNull()
        ?.get(PartyMember.linkedCharacterId)
}

/**
 * GET /api/parties/seated. The parties you are in but do not own.
 *
 * Here rather than in PartyRoutes.kt, next to the one query it calls: this is the app's only read
 * that crosses accounts, and it is worth being able to see the route and the rule together.
 */
internal suspend fun RoutingContext.listSeatedParties() {
    val (userId, email) = call.principalIdAndEmail()
    val parties =
        dbQuery {
            ensureUser(userId, email)
            partiesSeatedIn(userId)
        }
    call.respond(parties)
}

/**
 * Who is asking about a party: its owner, or somebody with a seat in it. Null is neither, which is
 * every other account and the answer that keeps two accounts apart.
 */
internal data class PartyViewer(
    val owner: Boolean,
    /** The member's own character, which their clear is read against. Null for the owner. */
    val asCharacter: Uuid?,
)

internal fun viewerOf(
    row: ResultRow,
    userId: String,
): PartyViewer? =
    if (row[Party.userId] == userId) {
        PartyViewer(owner = true, asCharacter = null)
    } else {
        seatedCharacterIn(row[Party.id], userId)?.let { PartyViewer(owner = false, asCharacter = it) }
    }
