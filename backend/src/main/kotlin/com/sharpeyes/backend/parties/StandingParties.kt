package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Two linked accounts that each keep a party for the same boss and the same people: two pools for one
// night. Neither is read across (MemberReads), and a character is not bound into the other owner's
// copy (seatInLinkedParties), so each stays its own book. Inside a transaction, like the rest.

/** A standing party, with its standing seat names, own seat included. */
internal data class StandingParty(
    val id: Uuid,
    val owner: String,
    val bossId: Uuid,
    val leader: String,
    val members: List<String>,
) {
    fun seats(name: String) = members.any { it.equals(name, ignoreCase = true) }
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
    val seats =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId inList rows.map { it[Party.id] }) and (PartyMember.standing eq true) }
            .orderBy(PartyMember.position, SortOrder.ASC)
            .toList()
            .groupBy({ it[PartyMember.partyId] }, { it[PartyMember.name] })
    return rows.map {
        StandingParty(
            id = it[Party.id],
            owner = it[Party.userId],
            bossId = it[Party.bossCatalogId],
            leader = it[Characters.name],
            members = seats[it[Party.id]].orEmpty(),
        )
    }
}

/**
 * The bosses [userId] already runs [name] on in a party of their own. Binding that character into a
 * linked owner's party for one of them as well would make one night two pools, so linking leaves
 * those seats unbound. See seatInLinkedParties.
 */
internal fun bossesRunInOwnParty(
    userId: String,
    name: String,
): Set<Uuid> =
    standingParties(listOf(userId))
        .filter { it.leader.equals(name, ignoreCase = true) || it.seats(name) }
        .mapTo(mutableSetOf()) { it.bossId }

/** A character more than one party holds for one boss, and which parties hold them. */
internal data class SeatClash(
    val bossId: Uuid,
    val name: String,
    val holders: List<StandingParty>,
)

/** Every character held by more than one of [parties] for one boss. */
internal fun clashesIn(parties: List<StandingParty>): List<SeatClash> =
    parties
        .flatMap { party -> party.members.map { Triple(party.bossId, it, party) } }
        .groupBy { (boss, name, _) -> boss to name.lowercase() }
        .values
        .map { seats -> seats.distinctBy { it.third.id } }
        .filter { it.size > 1 }
        .map { seats -> SeatClash(seats.first().first, seats.first().second, seats.map { it.third }) }
