package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.clearSkipsOfSeats
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publishToParty
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import com.sharpeyes.backend.plugins.Refusal
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Answering a party invite: Accept seats the character, Decline (or the owner withdrawing it) drops
// it. Inside a transaction, like the rest. See PartyInvites.kt.

/** What answering an invite came to. */
internal sealed interface InviteAnswer {
    data object NotFound : InviteAnswer

    data class Refused(
        val refusal: Refusal,
    ) : InviteAnswer

    data class Joined(
        val partyId: Uuid,
    ) : InviteAnswer
}

/**
 * Takes the seat, as if the owner had typed the name themselves (writeMembers), so every later rule
 * about a standing seat applies to it unchanged. Refused, and the invite dropped, when the party is
 * gone, the character has joined another party for the boss since, or the two are no longer friends.
 */
internal fun acceptInvite(
    userId: String,
    inviteId: Uuid,
    now: Instant,
): InviteAnswer {
    val invite = inviteOf(inviteId, userId) ?: return InviteAnswer.NotFound
    dropInvite(inviteId)
    val party =
        Party
            .innerJoin(BossCatalog)
            .selectAll()
            .where { (Party.id eq invite[PartyInvite.partyId]) and (Party.standing eq true) }
            .firstOrNull()
    return if (party == null) {
        InviteAnswer.Refused(Refusal("That party is gone. Ask for a new invite."))
    } else {
        join(userId, invite, party, now)
    }
}

private fun join(
    userId: String,
    invite: ResultRow,
    party: ResultRow,
    now: Instant,
): InviteAnswer {
    val partyId = party[Party.id]
    val characterId = invite[PartyInvite.characterId]
    val name = invite[Characters.name]
    val owner = party[Party.userId]
    return when {
        inPartyFor(characterId, party[Party.bossCatalogId], partyId) ->
            InviteAnswer.Refused(Refusal("$name is already in a party for ${party[BossCatalog.name]}. Leave it first."))
        linkedCharactersFor(owner)[name.lowercase()] != characterId ->
            InviteAnswer.Refused(Refusal("You're no longer friends. Ask for a new invite."))
        else -> {
            seat(partyId, party[Party.characterId], owner, name, now)
            publishToParty(partyId, Topic.PARTY)
            answered(owner, userId, partyId, name, accepted = true, now)
            InviteAnswer.Joined(partyId)
        }
    }
}

/**
 * Drops an invite: declined by the invitee, or withdrawn by the party's owner. False when it is
 * neither's to drop.
 */
internal fun dropInviteAs(
    userId: String,
    inviteId: Uuid,
    now: Instant,
): Boolean {
    val mine = inviteOf(inviteId, userId)
    if (mine != null) {
        dropInvite(inviteId)
        val owner = Party.selectAll().where { Party.id eq mine[PartyInvite.partyId] }.first()[Party.userId]
        answered(owner, userId, mine[PartyInvite.partyId], mine[Characters.name], accepted = false, now)
    }
    val owned =
        mine == null &&
            !PartyInvite
                .join(Party, JoinType.INNER, PartyInvite.partyId, Party.id)
                .selectAll()
                .where { (PartyInvite.id eq inviteId) and (Party.userId eq userId) }
                .empty()
    if (owned) dropInvite(inviteId)
    return mine != null || owned
}

/** The invite, when its character is [userId]'s. */
private fun inviteOf(
    inviteId: Uuid,
    userId: String,
) = PartyInvite
    .join(Characters, JoinType.INNER, PartyInvite.characterId, Characters.id)
    .selectAll()
    .where { (PartyInvite.id eq inviteId) and (Characters.userId eq userId) }
    .firstOrNull()

private fun dropInvite(inviteId: Uuid) {
    PartyInvite.deleteWhere { PartyInvite.id eq inviteId }
    resolve(NotificationKind.PARTY_INVITE, listOf(inviteId))
}

/** The usual roster plus [name], every seat keeping its split. */
private fun seat(
    partyId: Uuid,
    ownCharacterId: Uuid,
    owner: String,
    name: String,
    now: Instant,
) {
    val own = ownSeatName(ownCharacterId).lowercase()
    val seats =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
            .orderBy(PartyMember.position, SortOrder.ASC)
            .toList()
    val others = seats.map { it[PartyMember.name] }.filterNot { it.lowercase() == own }
    val shares = seats.associate { it[PartyMember.name] to it[PartyMember.shares] }
    writeMembers(partyId, ownCharacterId, others + name, SeatContext(owner, emptyMap(), now), shares)
    syncPiecesForParty(partyId, now)
    clearSkipsOfSeats(partyId)
}

private fun answered(
    owner: String,
    invitee: String,
    partyId: Uuid,
    name: String,
    accepted: Boolean,
    now: Instant,
) {
    val payload =
        buildJsonObject {
            partyFacts(partyId).forEach { (k, v) -> put(k, v) }
            put("character", name)
            put("accepted", accepted)
        }
    notify(owner, NotificationKind.PARTY_INVITE_ANSWERED, now, actorId = invitee, payload = payload)
}
