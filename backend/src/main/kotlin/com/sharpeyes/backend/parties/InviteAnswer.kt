package com.sharpeyes.backend.parties

import com.sharpeyes.api.system.Refusal
import com.sharpeyes.backend.bosses.clearSkipsOfSeats
import com.sharpeyes.backend.bosses.weekOf
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
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
    val boss = party[BossCatalog.name]
    // Accepting is the player saying to move it, so a party holding it is left. See PartyMoves.kt.
    val holder = holderOf(characterId, party[Party.bossCatalogId], partyId)
    val ranThisWeek = holder != null && recordedIn(holder.partyId, characterId, currentWeek(), now)
    return when {
        holder?.own == true -> InviteAnswer.Refused(Refusal("$name has its own $boss party. Remove it first."))
        linkedCharactersFor(owner)[name.lowercase()] != characterId ->
            InviteAnswer.Refused(Refusal("You're no longer friends. Ask for a new invite."))
        // A one-off is one night: one already run elsewhere this week cannot be this one too.
        ranThisWeek && party[Party.oneOff] -> InviteAnswer.Refused(Refusal("$name already ran $boss this week."))
        else -> {
            if (holder != null) moveOut(holder.partyId, characterId, now)
            // Ran with its old party this week, so it joins this one from next week. This week is
            // written as it reads now, without it.
            if (ranThisWeek && currentWeek() !in weeksSpelledOutFor(partyId)) freezeWeek(partyId, currentWeek())
            seat(partyId, party[Party.characterId], owner, name, characterId, now)
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

/** The usual roster plus [name], every seat keeping its split, and a one-off's night as createParty writes it. */
private fun seat(
    partyId: Uuid,
    ownCharacterId: Uuid,
    owner: String,
    name: String,
    characterId: Uuid,
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
    // Read before writeMembers, which an unwritten night would otherwise read back through.
    val night =
        if (isOneOff(partyId)) {
            rosterNamesFor(partyId, weekOf(todayIn(now))).filterNot { it.lowercase() in setOf(own, name.lowercase()) }
        } else {
            null
        }
    val context = SeatContext(owner, emptyMap(), now)
    // A one-off's guests stand nowhere but its night, so its seats are written in the night's order:
    // `others` alone would retire them and put the friend joining ahead of them.
    writeMembers(partyId, ownCharacterId, (night ?: others) + name, context, shares)
    if (night != null) writeNightRoster(partyId, ownCharacterId, night + name, now, context)
    // insertSeat binds only a seat it creates. One typed before the friendship, or unbound when the
    // party was taken off the lists, is reused by name and would stay nobody's.
    PartyMember.update({
        (PartyMember.partyId eq partyId) and (PartyMember.name.lowerCase() eq name.lowercase()) and
            PartyMember.characterId.isNull()
    }) { it[linkedCharacterId] = characterId }
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
