package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.partySeatsChanged
import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyReadCutoff
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publish
import com.sharpeyes.backend.events.publishToParty
import com.sharpeyes.backend.friends.seatCharacters
import com.sharpeyes.backend.plugins.Refusal
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.greaterEq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Two linked accounts that each keep a party for the same boss and the same people: two pools for one
// night. Combining keeps one and retires the other, and both owners have to agree on which.
//
// No drop moves. Before the cutoff each book keeps what it logged; from the cutoff on there is one
// pool. The other owner reads the kept party only from the cutoff, and the kept party's owner reads
// none of the retired one (PartyReadCutoff, read by SharedBooks.kt), so a night both logged is never
// counted in both books. Inside a transaction, like the rest.

/**
 * A standing party as combining reads it. [members] are standing seat names, own seat included, and
 * [own] the lowercased ones that are the owner's own characters: removeMember takes none of those out.
 */
internal data class StandingParty(
    val id: Uuid,
    val owner: String,
    val bossId: Uuid,
    val leader: String,
    val world: String,
    val difficulty: String?,
    val members: List<String>,
    val own: Set<String> = emptySet(),
) {
    fun seats(name: String) = members.any { it.equals(name, ignoreCase = true) }

    fun canLose(name: String) = name.lowercase() !in own && !leader.equals(name, ignoreCase = true)
}

/** Two parties that could be combined, and which of them can be kept. */
internal data class CombinablePair(
    val mine: StandingParty,
    val theirs: StandingParty,
    val keepable: List<Uuid>,
) {
    fun isOf(
        a: Uuid,
        b: Uuid,
    ) = setOf(mine.id, theirs.id) == setOf(a, b)
}

/** Standing, shared-able parties of [owners]: not solo, not a one-off. */
internal fun standingParties(owners: Collection<String>): List<StandingParty> {
    if (owners.isEmpty()) return emptyList()
    val rows =
        Party
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where {
                (Party.userId inList owners) and (Party.standing eq true) and
                    (Party.solo eq false) and (Party.oneOff eq false)
            }.toList()
    val seatRows =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId inList rows.map { it[Party.id] }) and (PartyMember.standing eq true) }
            .orderBy(PartyMember.position, SortOrder.ASC)
            .toList()
    val seats = seatRows.groupBy({ it[PartyMember.partyId] }, { it[PartyMember.name] })
    val own =
        seatRows
            .filter { it[PartyMember.characterId] != null }
            .groupBy({ it[PartyMember.partyId] }, { it[PartyMember.name].lowercase() })
    return rows.map {
        StandingParty(
            id = it[Party.id],
            owner = it[Party.userId],
            bossId = it[Party.bossCatalogId],
            leader = it[Characters.name],
            world = it[Characters.worldType],
            difficulty = it[Party.difficulty],
            members = seats[it[Party.id]].orEmpty(),
            own = own[it[Party.id]].orEmpty().toSet(),
        )
    }
}

/**
 * Every pair of a party of yours and a linked account's on the same boss in the same world, where
 * one already seats the other's own character.
 *
 * Only that one can be kept: the other owner joins it through the seat it already has, so nobody's
 * roster is rewritten by a combine.
 */
internal fun combinablePairs(userId: String): List<CombinablePair> {
    val theirs = standingParties(linkedAccountsOf(userId))
    return standingParties(listOf(userId)).flatMap { mine ->
        theirs
            .filter { it.bossId == mine.bossId && it.world == mine.world }
            .mapNotNull { other ->
                val keepable =
                    listOfNotNull(
                        mine.id.takeIf { mine.seats(other.leader) },
                        other.id.takeIf { other.seats(mine.leader) },
                    )
                if (keepable.isEmpty()) null else CombinablePair(mine, other, keepable)
            }
    }
}

/**
 * The bosses [userId] already runs [name] on in a party of their own. Binding that character into a
 * linked owner's party for one of them as well is the duplicate combining exists to end, so linking
 * leaves those seats unbound until the two are combined. See seatInLinkedParties.
 */
internal fun bossesRunInOwnParty(
    userId: String,
    name: String,
): Set<Uuid> =
    standingParties(listOf(userId))
        .filter { it.leader.equals(name, ignoreCase = true) || it.seats(name) }
        .mapTo(mutableSetOf()) { it.bossId }

/**
 * The date the kept party is shared from: this period's start, unless BOTH parties already logged a
 * drop in it, which may be the same drop twice. Then the next period's, so that night stays in each
 * book alone.
 */
internal fun cutoffFor(
    keep: Uuid,
    retire: Uuid,
    bossId: Uuid,
    now: Instant,
): LocalDate {
    val reset = BossCatalog.selectAll().where { BossCatalog.id eq bossId }.single()[BossCatalog.reset]
    val period = periodStartFor(reset, now)
    val bothLogged =
        listOf(keep, retire).all { party ->
            !PartyLoot
                .selectAll()
                .where { (PartyLoot.partyId eq party) and (PartyLoot.droppedOn greaterEq period) }
                .empty()
        }
    return if (bothLogged) periodAfter(reset, period) else period
}

internal sealed interface CombineAnswer {
    data object NotFound : CombineAnswer

    data class Refused(
        val refusal: Refusal,
    ) : CombineAnswer

    data object Done : CombineAnswer
}

/** Keeps [keep] and retires [retire], once both owners agreed. See CombineProposals.kt. */
internal fun combine(
    keep: StandingParty,
    retire: StandingParty,
    now: Instant,
) {
    val cutoff = cutoffFor(keep.id, retire.id, keep.bossId, now)
    // Retired the way a disband retires a party with a pool, without retireOrDeleteParty's withdrawn
    // clear: the night was played, and the tick is a real one.
    Party.update({ Party.id eq retire.id }) {
        it[standing] = false
        it[combinedInto] = keep.id
        it[updatedAt] = now
    }
    PartyMember.update({ PartyMember.partyId eq retire.id }) { it[linkedCharacterId] = null }
    PartyReadCutoff.upsert {
        it[partyId] = keep.id
        it[userId] = retire.owner
        it[sharedFrom] = cutoff
    }
    PartyReadCutoff.upsert {
        it[partyId] = retire.id
        it[userId] = keep.owner
        it[sharedFrom] = null
    }
    // Their characters were held back from the kept party while their own stood. See bossesRunInOwnParty.
    seatCharacters(retire.owner)
    partySeatsChanged(keep.id, now)
    publish(listOf(keep.owner, retire.owner), Topic.PARTY)
    publishToParty(keep.id, Topic.PARTY)
}
