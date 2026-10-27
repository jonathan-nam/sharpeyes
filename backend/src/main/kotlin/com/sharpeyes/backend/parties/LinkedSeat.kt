package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.inSubQuery
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.select
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

/**
 * A seat that puts its account in the party for [week]: in the usual roster, or named in that week's
 * (a one-off's night, a guest's week). Not standing alone, which leaves out a one-off's guests. A seat
 * retired out of the roster is not in a week it did not run, so leaving still takes the party away.
 */
internal fun seatedFor(week: LocalDate): Op<Boolean> {
    val ranThatWeek = PartyWeekSeat.select(PartyWeekSeat.memberId).where { PartyWeekSeat.weekStart eq week }
    return (PartyMember.standing eq true) or (PartyMember.id inSubQuery ranThatWeek)
}

/** The linked seats that ran [partyId] in [period], by that period's roster. */
internal fun linkedSeatsOn(
    partyId: Uuid,
    period: LocalDate,
): List<LinkedSeat> {
    val ran = rosterFor(partyId, period).toSet()
    return linkedSeats(partyId) { Op.TRUE }.filter { it.memberId in ran }
}

/** Every account [partyId] reaches this week: its owner, and whoever is in it (see seatedFor). */
internal fun audienceOf(partyId: Uuid): Set<String> {
    val owner =
        Party
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
            ?.get(Party.userId) ?: return emptySet()
    return setOf(owner) + linkedSeats(partyId) { seatedFor(currentWeek()) }.map { it.userId }
}

private fun linkedSeats(
    partyId: Uuid,
    seated: () -> Op<Boolean>,
): List<LinkedSeat> =
    PartyMember
        .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
        .selectAll()
        .where {
            (PartyMember.partyId inList listOf(partyId)) and
                PartyMember.linkedCharacterId.isNotNull() and
                seated()
        }.map { LinkedSeat(it[PartyMember.id], it[Characters.id], it[Characters.userId]) }
