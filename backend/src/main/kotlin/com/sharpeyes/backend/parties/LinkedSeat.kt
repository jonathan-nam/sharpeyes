package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Who else a party reaches: the seats bound to another account's character
// (party_member.linked_character_id), and those accounts. What anything that must reach a party's
// other members is built on, so "who is in this party" has one answer. Inside a transaction.

/** One seat of a party that is another account's character. */
internal data class LinkedSeat(
    val memberId: Uuid,
    val characterId: Uuid,
    val userId: String,
)

/** The linked seats that ran [partyId] in [period], by that period's roster. */
internal fun linkedSeatsOn(
    partyId: Uuid,
    period: LocalDate,
): List<LinkedSeat> {
    val ran = rosterFor(partyId, period).toSet()
    return linkedSeats(partyId).filter { it.memberId in ran }
}

/** Every account [partyId] reaches: its owner, and whoever holds a standing seat in it. */
internal fun audienceOf(partyId: Uuid): Set<String> {
    val owner =
        Party
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
            ?.get(Party.userId) ?: return emptySet()
    return setOf(owner) + linkedSeats(partyId).map { it.userId }
}

private fun linkedSeats(partyId: Uuid): List<LinkedSeat> =
    PartyMember
        .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
        .selectAll()
        .where {
            (PartyMember.partyId inList listOf(partyId)) and
                PartyMember.linkedCharacterId.isNotNull() and
                (PartyMember.standing eq true)
        }.map { LinkedSeat(it[PartyMember.id], it[Characters.id], it[Characters.userId]) }
