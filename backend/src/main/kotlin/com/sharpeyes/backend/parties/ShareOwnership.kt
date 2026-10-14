package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Which shares of a sale are the owner's business. A share between two other members is theirs to
// settle and never reaches this account, so it is neither marked here nor waited on.

/** The seats that are the owner's own characters, across [partyIds]. What isMine reads on the frontend. */
internal fun ownSeatsIn(partyIds: List<Uuid>): Set<Uuid> =
    if (partyIds.isEmpty()) {
        emptySet()
    } else {
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId inList partyIds) and PartyMember.characterId.isNotNull() }
            .map { it[PartyMember.id] }
            .toSet()
    }

/** Whether a share passes through one of the owner's seats: they sold or bought it, or are owed it. */
internal fun crossesOwner(
    lootId: Uuid,
    memberId: Uuid,
): Boolean {
    val seller =
        PartyLoot
            .selectAll()
            .where { PartyLoot.id eq lootId }
            .firstOrNull()
            ?.get(PartyLoot.sellerMemberId)
    return PartyMember
        .selectAll()
        .where { PartyMember.id inList listOfNotNull(seller, memberId) }
        .any { it[PartyMember.characterId] != null }
}
