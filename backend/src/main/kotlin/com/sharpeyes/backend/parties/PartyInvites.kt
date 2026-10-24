package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Party invites, the in-game way: naming a friend's character in a roster offers them the seat, and
// only their Accept writes it. A character already in a party for the boss is not invited at all,
// and the owner is told. Inside a transaction, like the rest. See V92__party_invite.sql.

/** A roster name that is a linked friend's character and not yet in this party. */
internal data class Invitee(
    val name: String,
    val characterId: Uuid,
)

/** What a save did about the friends it named. */
internal data class InviteOutcome(
    val invited: List<String>,
    val alreadyPartied: List<String>,
)

/** A pending invite as the party's owner sees it. */
@Serializable
data class PendingInviteView(
    val id: String,
    val name: String,
)

/** A pending invite as the invitee sees it: named the way the bell names it. See partyFacts. */
@Serializable
data class IncomingInviteView(
    val id: String,
    val partyId: String,
    /** Which of your characters it offers the seat to. */
    val character: String,
    val boss: String,
    val difficulty: String?,
    /** The party owner's character. */
    val leader: String,
)

/**
 * Splits a roster into the names to seat now and the friends' characters to invite instead.
 *
 * A name already standing in [partyId] stays a seat, whoever it is: they are in the party. Anything
 * else that is a linked account's character becomes an invite, a retired seat included, since
 * leaving and being put back is joining again.
 */
internal fun splitInvitees(
    userId: String,
    partyId: Uuid?,
    members: List<String>,
): Pair<List<String>, List<Invitee>> {
    val linked = linkedCharactersFor(userId)
    if (linked.isEmpty()) return members to emptyList()
    val standing =
        partyId
            ?.let { standingRosterOf(it) }
            .orEmpty()
            .map { it.lowercase() }
            .toSet()
    val invitees =
        members.mapNotNull { raw ->
            val name = raw.trim()
            linked[name.lowercase()]?.takeIf { name.lowercase() !in standing }?.let { Invitee(name, it) }
        }
    val invited = invitees.map { it.name.lowercase() }.toSet()
    return members.filterNot { it.trim().lowercase() in invited } to invitees
}

/** A week's roster with its friends taken out, who are invited to the party itself. */
internal data class WeekInvites(
    val named: List<String>?,
    val invitees: List<Invitee>,
) {
    /** Nobody left to write once the friends are out: the week stays as it was. */
    val writes get() = invitees.isEmpty() || !named.isNullOrEmpty()
}

internal fun weekInvites(
    userId: String,
    partyId: Uuid,
    members: List<String>?,
): WeekInvites {
    val split = members?.let { splitInvitees(userId, partyId, it) }
    return WeekInvites(split?.first, split?.second.orEmpty())
}

/** This save with its friends taken out, and who they were. Their splits go with them. */
internal fun SavePartyRequest.inviting(
    userId: String,
    partyId: Uuid?,
): Pair<SavePartyRequest, List<Invitee>> {
    val (kept, invitees) = splitInvitees(userId, partyId, members)
    if (invitees.isEmpty()) return this to invitees
    val out = invitees.map { it.name.lowercase() }.toSet()
    val without = { by: Map<String, Int> -> by.filterKeys { it.trim().lowercase() !in out } }
    return copy(members = kept, shares = without(shares), pieceShares = without(pieceShares)) to invitees
}

/** A save's answer, with the invites it made sent and said. Anything but a saved party passes through. */
internal fun Any?.withInvites(
    ownerId: String,
    invitees: List<Invitee>,
    now: Instant,
): Any? {
    if (this !is PartyResponse || invitees.isEmpty()) return this
    val partyId = Uuid.parse(id)
    val outcome = sendInvites(ownerId, partyId, invitees, now)
    return findParty(partyId, ownerId)!!.copy(invited = outcome.invited, alreadyPartied = outcome.alreadyPartied)
}

/**
 * Whether [characterId] is already in a party for [bossId] other than [except]: one of its own, or a
 * seat in somebody else's. A solo pool is not a party.
 */
internal fun inPartyFor(
    characterId: Uuid,
    bossId: Uuid,
    except: Uuid,
): Boolean {
    val own =
        Party
            .selectAll()
            .where {
                (Party.characterId eq characterId) and (Party.bossCatalogId eq bossId) and
                    (Party.standing eq true) and (Party.solo eq false) and (Party.id neq except)
            }.empty()
            .not()
    val seated =
        PartyMember
            .join(Party, JoinType.INNER, PartyMember.partyId, Party.id)
            .selectAll()
            .where {
                (PartyMember.linkedCharacterId eq characterId) and (PartyMember.standing eq true) and
                    (Party.bossCatalogId eq bossId) and (Party.standing eq true) and (Party.id neq except)
            }.empty()
            .not()
    return own || seated
}

/** Offers [partyId]'s seats to [invitees], refusing any already in a party for its boss. */
internal fun sendInvites(
    ownerId: String,
    partyId: Uuid,
    invitees: List<Invitee>,
    now: Instant,
): InviteOutcome {
    if (invitees.isEmpty()) return InviteOutcome(emptyList(), emptyList())
    val party = Party.selectAll().where { Party.id eq partyId }.first()
    val bossId = party[Party.bossCatalogId]
    val (partied, free) = invitees.partition { inPartyFor(it.characterId, bossId, partyId) }
    val facts = partyFacts(partyId)
    for (invitee in free) {
        val id = Uuid.random()
        val inserted =
            PartyInvite
                .insertIgnore {
                    it[PartyInvite.id] = id
                    it[PartyInvite.partyId] = partyId
                    it[characterId] = invitee.characterId
                    it[invitedBy] = ownerId
                    it[createdAt] = now
                }.insertedCount > 0
        // Inviting twice is one invite, and one notification.
        if (inserted) {
            val payload =
                buildJsonObject {
                    facts.forEach { (k, v) -> put(k, v) }
                    put("character", invitee.name)
                }
            notify(userOf(invitee.characterId), NotificationKind.PARTY_INVITE, now, id, ownerId, payload)
        }
    }
    return InviteOutcome(free.map { it.name }, partied.map { it.name })
}

/** How the bell names a party: its boss, mode and the owner's character. */
internal fun partyFacts(partyId: Uuid): Map<String, String?> {
    val row =
        Party
            .innerJoin(BossCatalog)
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { Party.id eq partyId }
            .first()
    return mapOf(
        "partyId" to partyId.toString(),
        "boss" to row[BossCatalog.name],
        "difficulty" to row[Party.difficulty],
        "leader" to row[Characters.name],
    )
}

private fun userOf(characterId: Uuid): String =
    Characters
        .selectAll()
        .where { Characters.id eq characterId }
        .first()[Characters.userId]

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
