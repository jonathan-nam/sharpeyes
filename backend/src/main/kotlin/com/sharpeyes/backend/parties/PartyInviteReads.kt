package com.sharpeyes.backend.parties

import com.sharpeyes.api.invites.IncomingInviteView
import com.sharpeyes.api.invites.PendingInviteView
import com.sharpeyes.api.invites.SentInviteView
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Pending party invites, read for whoever is on either end of one. See PartyInvites.kt.

/**
 * Every pending invite to one of [userId]'s characters, newest first, so one cleared from the bell
 * can still be answered from Social.
 */
internal fun invitesWaitingOn(userId: String): List<IncomingInviteView> {
    val mine =
        Characters
            .select(Characters.id, Characters.name)
            .where { Characters.userId eq userId }
            .associate { it[Characters.id] to it[Characters.name] }
    if (mine.isEmpty()) return emptyList()
    return PartyInvite
        .selectAll()
        .where { PartyInvite.characterId inList mine.keys }
        .orderBy(PartyInvite.createdAt, SortOrder.DESC)
        .map { row ->
            val facts = partyFacts(row[PartyInvite.partyId])
            IncomingInviteView(
                id = row[PartyInvite.id].toString(),
                partyId = row[PartyInvite.partyId].toString(),
                character = mine.getValue(row[PartyInvite.characterId]),
                boss = facts["boss"].orEmpty(),
                difficulty = facts["difficulty"],
                leader = facts["leader"].orEmpty(),
            )
        }
}

/** Every pending invite out of [userId]'s parties, newest first, whether or not a list shows the party. */
internal fun invitesSentBy(userId: String): List<SentInviteView> =
    PartyInvite
        .join(Party, JoinType.INNER, PartyInvite.partyId, Party.id)
        .join(Characters, JoinType.INNER, PartyInvite.characterId, Characters.id)
        .selectAll()
        .where { Party.userId eq userId }
        .orderBy(PartyInvite.createdAt, SortOrder.DESC)
        .map { row ->
            val facts = partyFacts(row[PartyInvite.partyId])
            SentInviteView(
                id = row[PartyInvite.id].toString(),
                partyId = row[PartyInvite.partyId].toString(),
                character = row[Characters.name],
                boss = facts["boss"].orEmpty(),
                difficulty = facts["difficulty"],
                leader = facts["leader"].orEmpty(),
            )
        }

/** Every pending invite of these parties, oldest first, for their owner's rows. */
internal fun pendingInvitesFor(partyIds: Collection<Uuid>): Map<Uuid, List<PendingInviteView>> {
    if (partyIds.isEmpty()) return emptyMap()
    return PartyInvite
        .join(Characters, JoinType.INNER, PartyInvite.characterId, Characters.id)
        .selectAll()
        .where { PartyInvite.partyId inList partyIds }
        .orderBy(PartyInvite.createdAt, SortOrder.ASC)
        .groupBy({ it[PartyInvite.partyId] }) {
            PendingInviteView(it[PartyInvite.id].toString(), it[Characters.name])
        }
}
