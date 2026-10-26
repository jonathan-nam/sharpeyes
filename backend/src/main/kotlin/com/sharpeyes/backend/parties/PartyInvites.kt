package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.groups.groupmatesOf
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Party invites, the in-game way: naming a friend's character in a roster offers them the seat, and
// only their Accept writes it, unless the two of you share a group (V102), which seats it at once. A
// character already in a party for the boss is neither, and the owner is told. Inside a transaction,
// like the rest. See V92__party_invite.sql.

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

/** A roster, split by what happens to each friend's character it names. */
internal data class RosterSplit(
    /** The names the save writes, groupmates' characters among them. */
    val kept: List<String>,
    val invitees: List<Invitee>,
    /** Groupmates' characters, seated by the save and bound to their accounts after it. */
    val seated: List<Invitee> = emptyList(),
    /** Groupmates' characters left out, being in a party for the boss already. */
    val partied: List<String> = emptyList(),
) {
    /** Every name the save leaves out. */
    val out get() = (invitees.map { it.name } + partied).map { it.lowercase() }.toSet()

    /** Named no friend's character at all, so a save has nothing more to do. */
    val none get() = out.isEmpty() && seated.isEmpty()
}

/**
 * Splits a roster into the names to seat now and the friends' characters to invite instead.
 *
 * A name already standing in [partyId] stays a seat, whoever it is: they are in the party. Anything
 * else that is a linked account's character becomes an invite, a retired seat included, since
 * leaving and being put back is joining again. Unless that account shares a group with [adder], who
 * is the one naming them: joining the group was their consent, so they are seated (see V102).
 */
internal fun splitInvitees(
    userId: String,
    partyId: Uuid?,
    members: List<String>,
    bossId: Uuid? = partyId?.let(::bossIdOfParty),
    adder: String = userId,
): RosterSplit {
    val linked = linkedCharactersFor(userId)
    if (linked.isEmpty()) return RosterSplit(members, emptyList())
    val standing =
        partyId
            ?.let { standingRosterOf(it) }
            .orEmpty()
            .map { it.lowercase() }
            .toSet()
    val friends =
        members.mapNotNull { raw ->
            val name = raw.trim()
            linked[name.lowercase()]?.takeIf { name.lowercase() !in standing }?.let { Invitee(name, it) }
        }
    val mates = if (friends.isEmpty() || bossId == null) emptySet() else groupmatesOf(adder)
    val (grouped, invitees) = friends.partition { userOf(it.characterId) in mates }
    val (partied, seated) = grouped.partition { inPartyFor(it.characterId, bossId!!, partyId ?: Uuid.NIL) }
    val split = RosterSplit(members, invitees, seated, partied.map { it.name })
    return split.copy(kept = members.filterNot { it.trim().lowercase() in split.out })
}

/** A week's roster with its friends taken out, who are invited to the party itself. */
internal data class WeekInvites(
    val named: List<String>?,
    val split: RosterSplit,
) {
    val invitees get() = split.invitees

    /** Nobody left to write once the friends are out: the week stays as it was. */
    val writes get() = split.out.isEmpty() || !named.isNullOrEmpty()
}

internal fun weekInvites(
    userId: String,
    partyId: Uuid,
    members: List<String>?,
    adder: String = userId,
): WeekInvites {
    val split = members?.let { splitInvitees(userId, partyId, it, adder = adder) }
    return WeekInvites(split?.kept, split ?: RosterSplit(emptyList(), emptyList()))
}

/** This save with its friends taken out, and what became of them. Their splits go with them. */
internal fun SavePartyRequest.inviting(
    userId: String,
    partyId: Uuid?,
    bossId: Uuid?,
    adder: String = userId,
): Pair<SavePartyRequest, RosterSplit> {
    val split = splitInvitees(userId, partyId, members, bossId, adder)
    if (split.out.isEmpty()) return this to split
    val without = { by: Map<String, Int> -> by.filterKeys { it.trim().lowercase() !in split.out } }
    return copy(members = split.kept, shares = without(shares), pieceShares = without(pieceShares)) to split
}

/**
 * A save's answer, with its groupmates bound and told, and its invites sent and said. Anything but a
 * saved party passes through.
 */
internal fun Any?.withInvites(
    ownerId: String,
    split: RosterSplit,
    now: Instant,
    adder: String = ownerId,
): Any? {
    if (this !is PartyResponse || split.none) return this
    val partyId = Uuid.parse(id)
    seatGroupmates(partyId, split.seated, adder, now)
    val outcome = sendInvites(ownerId, partyId, split.invitees, now)
    return findParty(partyId, ownerId)!!.copy(
        invited = outcome.invited,
        alreadyPartied = outcome.alreadyPartied + split.partied,
    )
}

/**
 * Binds each groupmate's seat to their character, and tells them.
 *
 * insertSeat binds only a seat it creates, so a name the party already had (a guest, or one typed
 * before the friendship) is bound here. Never one of the owner's own characters, which V75 forbids.
 */
private fun seatGroupmates(
    partyId: Uuid,
    seated: List<Invitee>,
    adder: String,
    now: Instant,
) {
    if (seated.isEmpty()) return
    val facts = partyFacts(partyId)
    for (mate in seated) {
        PartyMember.update({
            (PartyMember.partyId eq partyId) and (PartyMember.name.lowerCase() eq mate.name.lowercase()) and
                PartyMember.characterId.isNull()
        }) { it[linkedCharacterId] = mate.characterId }
        val payload =
            buildJsonObject {
                facts.forEach { (k, v) -> put(k, v) }
                put("character", mate.name)
            }
        notify(userOf(mate.characterId), NotificationKind.PARTY_ADDED, now, partyId, adder, payload)
    }
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
