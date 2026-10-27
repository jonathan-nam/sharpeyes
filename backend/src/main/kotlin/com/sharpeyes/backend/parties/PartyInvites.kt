package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.friends.linkedTo
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
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A friend's character named in a roster: seated and bound to their account at once, and they are
// told. Anybody else's name is a seat that binds to nobody. A character already in a party for the
// boss is left out, and the owner is told. Inside a transaction, like the rest.
//
// V92 sent an invite instead and seated nobody until Accept. That was friction for parties that
// already exist in the game, so no invite is sent any more; one still pending is answered as before
// (InviteAnswer.kt).

/** A roster name that is a friend's character and not yet standing in this party. */
internal data class FriendSeat(
    val name: String,
    val characterId: Uuid,
    /** Already bound in this party before the save (a guest seat from another week), so not news. */
    val bound: Boolean = false,
)

/** A roster, split by what happens to the friends' characters it names. */
internal data class RosterSplit(
    /** The names the save writes, friends' characters among them. */
    val kept: List<String>,
    /** Friends' characters, seated by the save and bound after it. */
    val seated: List<FriendSeat> = emptyList(),
    /** Friends' characters left out, being in a party for the boss already. */
    val partied: List<String> = emptyList(),
) {
    val out get() = partied.map { it.lowercase() }.toSet()
}

/**
 * Splits a roster into what the save writes and the friends' characters it cannot seat.
 *
 * A name already standing in [partyId] stays a seat, whoever it is: they are in the party. Anything
 * else that is a linked account's character is a friend to seat, unless it is in another party for
 * [bossId] (one per boss, V100).
 */
internal fun splitFriends(
    userId: String,
    partyId: Uuid?,
    members: List<String>,
    bossId: Uuid? = partyId?.let(::bossIdOfParty),
): RosterSplit {
    val linked = linkedCharactersFor(userId)
    if (linked.isEmpty() || bossId == null) return RosterSplit(members)
    val standing =
        partyId
            ?.let { standingRosterOf(it) }
            .orEmpty()
            .map { it.lowercase() }
            .toSet()
    val bound =
        partyId
            ?.let { id ->
                PartyMember
                    .selectAll()
                    .where { PartyMember.partyId eq id }
                    .mapNotNull { it[PartyMember.linkedCharacterId] }
            }.orEmpty()
            .toSet()
    val friends =
        members.mapNotNull { raw ->
            val name = raw.trim()
            linked[name.lowercase()]?.takeIf { name.lowercase() !in standing }?.let {
                FriendSeat(
                    name,
                    it,
                    it in bound,
                )
            }
        }
    val (partied, seated) = friends.partition { inPartyFor(it.characterId, bossId, partyId ?: Uuid.NIL) }
    val out = partied.map { it.name.lowercase() }.toSet()
    return RosterSplit(members.filterNot { it.trim().lowercase() in out }, seated, partied.map { it.name })
}

/** A week's roster with its already-partied friends taken out. */
internal data class WeekSplit(
    val named: List<String>?,
    val split: RosterSplit,
) {
    /** Nobody left to write once they are out: the week stays as it was. */
    val writes get() = split.partied.isEmpty() || !named.isNullOrEmpty()
}

internal fun weekSplit(
    userId: String,
    partyId: Uuid,
    members: List<String>?,
): WeekSplit {
    val split = members?.let { splitFriends(userId, partyId, it) }
    return WeekSplit(split?.kept, split ?: RosterSplit(emptyList()))
}

/** This save with its already-partied friends taken out, and what became of the rest. */
internal fun SavePartyRequest.seatingFriends(
    userId: String,
    partyId: Uuid?,
    bossId: Uuid?,
): Pair<SavePartyRequest, RosterSplit> {
    val split = splitFriends(userId, partyId, members, bossId)
    if (split.out.isEmpty()) return this to split
    val without = { by: Map<String, Int> -> by.filterKeys { it.trim().lowercase() !in split.out } }
    return copy(members = split.kept, shares = without(shares), pieceShares = without(pieceShares)) to split
}

/**
 * Why [userId], a joined member saving [keeper]'s party, cannot seat these friends, or null.
 *
 * A friend's character binds through the owner's friendship, so a member could otherwise link a
 * stranger of theirs into the party. They may seat only characters of their own friends (or their own).
 */
internal fun memberSeatRefusal(
    userId: String,
    keeper: String,
    seated: List<FriendSeat>,
): String? {
    if (keeper == userId) return null
    val strangers =
        seated.filter { seat ->
            val account = userOf(seat.characterId)
            account != userId && !linkedTo(userId, account)
        }
    return if (strangers.isEmpty()) {
        null
    } else {
        "You aren't friends with whoever plays ${strangers.joinToString(", ") { it.name }}. " +
            "Ask the party's owner to add them."
    }
}

/**
 * A save's answer, with its friends bound and told, and the ones it left out said. Anything but a
 * saved party passes through.
 */
internal fun Any?.withFriendSeats(
    ownerId: String,
    split: RosterSplit,
    now: Instant,
    adder: String = ownerId,
): Any? {
    if (this !is PartyResponse || (split.seated.isEmpty() && split.partied.isEmpty())) return this
    val partyId = Uuid.parse(id)
    bindFriends(partyId, split.seated, adder, now)
    return findParty(partyId, ownerId)!!.copy(alreadyPartied = split.partied)
}

/**
 * Binds each friend's seat to their character, and tells them.
 *
 * insertSeat binds only a seat it creates, so a name the party already had (a guest, or one typed
 * before the friendship) is bound here. Never one of the owner's own characters, which V75 forbids.
 * Told only when the seat was not theirs already, and never for adding your own character.
 */
private fun bindFriends(
    partyId: Uuid,
    seated: List<FriendSeat>,
    adder: String,
    now: Instant,
) {
    if (seated.isEmpty()) return
    val facts = partyFacts(partyId)
    for (seat in seated) {
        PartyMember.update({
            (PartyMember.partyId eq partyId) and (PartyMember.name.lowerCase() eq seat.name.lowercase()) and
                PartyMember.characterId.isNull() and PartyMember.linkedCharacterId.isNull()
        }) { it[linkedCharacterId] = seat.characterId }
        val account = userOf(seat.characterId)
        if (!seat.bound && account != adder) {
            val payload =
                buildJsonObject {
                    facts.forEach { (k, v) -> put(k, v) }
                    put("character", seat.name)
                }
            notify(account, NotificationKind.PARTY_ADDED, now, partyId, adder, payload)
        }
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
