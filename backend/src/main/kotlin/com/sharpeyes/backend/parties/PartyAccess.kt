package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Who may write into a party's pool: its owner, and every member who has joined.
//
// Recording follows whoever holds the loot, and that moves with the debt between two people, so it
// cannot be ownership. A member acts only as their own seats (LootPermissions.kt), which is what
// keeps a debt from being recorded in somebody else's name. Members are not split into roles on
// purpose: V85 dropped the Viewer/Editor table. All inside a transaction, like the rest.

/** True when [userId] may write into [partyId]'s pool: its owner, or a member with a standing seat. */
internal fun canEditParty(
    partyId: Uuid,
    userId: String,
): Boolean = ownsParty(partyId, userId) || isSeatedIn(partyId, userId)

/** [userId]'s standing seats in somebody else's [partyId]: the only seats a member may act as. */
internal fun mySeatsIn(
    partyId: Uuid,
    userId: String,
): Set<Uuid> =
    PartyMember
        .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
        .selectAll()
        .where {
            (PartyMember.partyId eq partyId) and
                (PartyMember.standing eq true) and
                (Characters.userId eq userId)
        }.map { it[PartyMember.id] }
        .toSet()

/**
 * Whether [userId] may act as seat [memberId] in [partyId]. The owner acts as anybody, the way every
 * write worked before members could write; a member only as one of their own seats.
 */
internal fun mayActAs(
    partyId: Uuid,
    userId: String,
    memberId: Uuid?,
): Boolean = ownsParty(partyId, userId) || (memberId != null && memberId in mySeatsIn(partyId, userId))

/** [this] as a member who does not own it sees it: not theirs, and the seats they act as. */
internal fun PartyResponse.asMember(userId: String): PartyResponse =
    copy(yours = false, yourSeats = mySeatsIn(Uuid.parse(id), userId).map { it.toString() })
