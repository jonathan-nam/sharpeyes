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
                }.map { it[Party.id] to it[PartyMember.id].toString() }
        }
    if (mySeats.isEmpty()) return emptyList()

    val seatsByParty = mySeats.groupBy({ it.first }) { it.second }
    val partyIds = seatsByParty.keys.toList()
    val nightsByParty =
        partyIds.associateWith { partyId ->
            nightsRunBy(partyId, seatsByParty[partyId].orEmpty().toSet())
        }
    // Read with YOUR user id, not the owner's: "whose character is this" is answered by your own
    // people list, which is the only address book you have. Their name for somebody is theirs.
    val seats = seatsFor(partyIds, userId)

    return Party
        .innerJoin(BossCatalog)
        .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
        .selectAll()
        .where { Party.id inList partyIds }
        .orderBy(BossCatalog.sortOrder)
        .map { row ->
            val partyId = row[Party.id]
            SeatedPartyResponse(
                id = partyId.toString(),
                bossKey = row[BossCatalog.bossKey],
                difficulty = row[Party.difficulty],
                minutes = row[Party.minutes],
                seats = seats[partyId].orEmpty(),
                mySeatIds = seatsByParty[partyId].orEmpty(),
                nights = nightsByParty[partyId].orEmpty(),
            )
        }
}

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
 * The drops from this pool that [mySeatIds] were on the roster for.
 *
 * Read off the pool's own rows rather than re-queried, so a night reads the same for a member as it
 * does for the owner. `ranThatWeek` is already the seats that ran the week a drop fell, resolved
 * per row against that week's roster (see rostersFor), which is exactly the question being asked:
 * a pool spans months and a member was not there for most of it.
 *
 * A row nobody is recorded as having run is left out. That is a pool row whose week has no roster
 * behind it, so it cannot say whether this account was there, and showing it would be answering
 * that question with a guess.
 */
private fun nightsRunBy(
    partyId: Uuid,
    mySeatIds: Set<String>,
): List<LootResponse> = lootFor(partyId).filter { loot -> loot.ranThatWeek.any { it in mySeatIds } }

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
