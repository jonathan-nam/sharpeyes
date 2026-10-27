package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.RosterNameOutcome
import com.sharpeyes.api.parties.RosterResult
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.friends.linkedTo
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import kotlinx.datetime.LocalDate
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A friend's character named in a roster. Anybody else's name is a seat that binds to nobody, so only
// a friendship links accounts. Inside a transaction, like the rest.
//
// In no other party for the boss, it is seated and bound at once. In another regular party, it is
// never moved by somebody else: its player is asked (a party_invite, V92), and only their answer
// moves it (PartyMoves.kt). A week-only roster seats it for that week and leaves its party alone.

/** A roster write: the usual roster, or who ran one week (a week's roster, or a one-off's night). */
internal sealed interface RosterWrite {
    data object Standing : RosterWrite

    data class Week(
        val week: LocalDate,
    ) : RosterWrite
}

/** The regular party holding a character for a boss. [own] when the character IS that party's config. */
internal data class Holder(
    val partyId: Uuid,
    val own: Boolean,
)

/** A friend's character a roster names, not already standing in this party, and what becomes of it. */
internal data class FriendSeat(
    val name: String,
    val characterId: Uuid,
    val result: RosterResult,
    /** The regular party holding it for the boss, when there is one. */
    val holder: Uuid? = null,
    /** Already bound in this party before the save (a guest seat from another week), so not news. */
    val bound: Boolean = false,
    /** What the saver is told, when anything. Never names a party the saver is not a friend of. */
    val text: String? = null,
)

/** A roster, split by what happens to the friends' characters it names. */
internal data class RosterSplit(
    /** The names the save writes. */
    val kept: List<String>,
    val friends: List<FriendSeat> = emptyList(),
) {
    /** Bound after the save: seated for good, or for the week. */
    val seated get() = friends.filter { it.result == RosterResult.SEATED || it.result == RosterResult.GUEST }

    /** Every name the save leaves out: asked, or left out. */
    val out get() =
        friends
            .filter { it.result == RosterResult.ASKED || it.result == RosterResult.LEFT_OUT }
            .map { it.name.lowercase() }
            .toSet()
}

/**
 * Splits a roster into what the save writes and what becomes of each friend's character it names.
 *
 * A name already standing in [partyId] stays a seat, whoever it is: they are in the party.
 */
internal fun splitFriends(
    userId: String,
    partyId: Uuid?,
    members: List<String>,
    bossId: Uuid? = partyId?.let(::bossIdOfParty),
    write: RosterWrite = RosterWrite.Standing,
    now: Instant,
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
                    .where {
                        PartyMember.partyId eq id
                    }.mapNotNull { it[PartyMember.linkedCharacterId] }
            }.orEmpty()
            .toSet()
    val boss = BossCatalog.selectAll().where { BossCatalog.id eq bossId }.first()[BossCatalog.name]
    val friends =
        members.mapNotNull { raw ->
            val name = raw.trim()
            linked[name.lowercase()]
                ?.takeIf { name.lowercase() !in standing }
                ?.let { classify(name, it, it in bound, Claim(partyId, bossId, boss, write), now) }
        }
    val split = RosterSplit(members, friends)
    return split.copy(kept = members.filterNot { it.trim().lowercase() in split.out })
}

/** Where a roster write is claiming a character: which party, for which boss, and for how long. */
private data class Claim(
    val partyId: Uuid?,
    val bossId: Uuid,
    val boss: String,
    val write: RosterWrite,
)

private fun classify(
    name: String,
    characterId: Uuid,
    bound: Boolean,
    claim: Claim,
    now: Instant,
): FriendSeat {
    val holder = holderOf(characterId, claim.bossId, claim.partyId ?: Uuid.NIL)
    val seat = FriendSeat(name, characterId, RosterResult.SEATED, holder?.partyId, bound)
    val write = claim.write
    return when {
        holder == null -> seat
        holder.own -> seat.copy(result = RosterResult.LEFT_OUT, text = "$name already has its own ${claim.boss} party.")
        write is RosterWrite.Week && recordedIn(holder.partyId, characterId, write.week, now) ->
            seat.copy(
                result = RosterResult.LEFT_OUT,
                text = "$name already ran ${claim.boss} ${if (write.week == currentWeek()) "this" else "that"} week.",
            )
        write is RosterWrite.Week -> seat.copy(result = RosterResult.GUEST)
        else -> seat.copy(result = RosterResult.ASKED, text = "Asked $name's player to move $name here.")
    }
}

/** A week's roster with the friends it cannot seat taken out. */
internal data class WeekSplit(
    val named: List<String>?,
    val split: RosterSplit,
) {
    /** Nobody left to write once they are out: the week stays as it was. */
    val writes get() = split.out.isEmpty() || !named.isNullOrEmpty()
}

internal fun weekSplit(
    userId: String,
    partyId: Uuid,
    members: List<String>?,
    week: LocalDate,
    now: Instant,
): WeekSplit {
    val split = members?.let { splitFriends(userId, partyId, it, write = RosterWrite.Week(week), now = now) }
    return WeekSplit(split?.kept, split ?: RosterSplit(emptyList()))
}

/** This save with the friends it cannot seat taken out, and what became of each. Their splits go too. */
internal fun SavePartyRequest.seatingFriends(
    userId: String,
    partyId: Uuid?,
    bossId: Uuid?,
    oneOff: Boolean,
    now: Instant,
): Pair<SavePartyRequest, RosterSplit> {
    val write = if (oneOff) RosterWrite.Week(currentWeek()) else RosterWrite.Standing
    val split = splitFriends(userId, partyId, members, bossId, write, now)
    if (split.out.isEmpty()) return this to split
    val without = { by: Map<String, Int> -> by.filterKeys { it.trim().lowercase() !in split.out } }
    return copy(members = split.kept, shares = without(shares), pieceShares = without(pieceShares)) to split
}

/**
 * Why [userId], a joined member saving [keeper]'s party, cannot name these friends, or null.
 *
 * A friend's character binds, or its player is asked, through the owner's friendship, so a member
 * could otherwise reach a stranger of theirs. They may name only their own friends' characters, or
 * their own.
 */
internal fun memberSeatRefusal(
    userId: String,
    keeper: String,
    friends: List<FriendSeat>,
): String? {
    if (keeper == userId) return null
    val strangers =
        friends.filter { seat ->
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
 * A save's answer, with its friends bound and told, its asks sent, its guests' other parties given
 * the week, and each friend's outcome said. Anything but a saved party passes through.
 */
internal fun Any?.withFriendSeats(
    ownerId: String,
    split: RosterSplit,
    now: Instant,
    adder: String = ownerId,
    week: LocalDate = currentWeek(),
): Any? {
    if (this !is PartyResponse || split.friends.isEmpty()) return this
    val partyId = Uuid.parse(id)
    bindFriends(partyId, split.seated, adder, now)
    split.friends.filter { it.result == RosterResult.GUEST }.forEach { lendForWeek(it, week, now) }
    val asked = split.friends.filter { it.result == RosterResult.ASKED }
    asked.forEach { askToMove(ownerId, partyId, it, now) }
    return findParty(partyId, ownerId)!!.copy(
        invited = asked.map { it.name },
        alreadyPartied = split.friends.filter { it.result == RosterResult.LEFT_OUT }.map { it.name },
        outcome = split.friends.map { RosterNameOutcome(it.name, it.result, it.text) },
    )
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
                    put("week", seat.result == RosterResult.GUEST)
                }
            notify(account, NotificationKind.PARTY_ADDED, now, partyId, adder, payload)
        }
    }
}

/**
 * Asks [seat]'s player to move it from its party into [partyId]. A party_invite, so it is answered,
 * listed and withdrawn the way every invite is. Asking twice is one ask.
 */
private fun askToMove(
    ownerId: String,
    partyId: Uuid,
    seat: FriendSeat,
    now: Instant,
) {
    val id = Uuid.random()
    val inserted =
        PartyInvite
            .insertIgnore {
                it[PartyInvite.id] = id
                it[PartyInvite.partyId] = partyId
                it[characterId] = seat.characterId
                it[invitedBy] = ownerId
                it[createdAt] = now
            }.insertedCount > 0
    if (!inserted) return
    // The player is a friend of both owners, so both parties are named to them.
    val from = seat.holder?.let(::partyFacts)
    val payload =
        buildJsonObject {
            partyFacts(partyId).forEach { (k, v) -> put(k, v) }
            put("character", seat.name)
            from?.let { put("fromLeader", it["leader"]) }
        }
    notify(userOf(seat.characterId), NotificationKind.PARTY_INVITE, now, id, ownerId, payload)
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

internal fun userOf(characterId: Uuid): String =
    Characters
        .selectAll()
        .where { Characters.id eq characterId }
        .first()[Characters.userId]
