package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

// A seat, written. Shared by the party's usual roster (PartyWrites.kt) and by one week's
// (PartyRoster.kt), because both are lists of character names that have to end up as the same
// rows: a seat is what a payout and a week's roster point at, so the two must never make one each
// for the same person. Inside a transaction, like the rest.

/** The name on a character of yours, which is the seat the config itself occupies. */
internal fun ownSeatName(ownCharacterId: Uuid): String =
    Characters
        .selectAll()
        .where { Characters.id eq ownCharacterId }
        .first()[Characters.name]

/**
 * The seats a roster names, YOUR character first.
 *
 * Read by the usual roster and by a week's, so the two cannot come to disagree about whether your
 * own character is in a party. They always are: the config IS that character, and they are usually
 * the seat that sold the drop, so leaving them out would make most sellers unnameable.
 */
internal fun seatNames(
    ownName: String,
    members: List<String>,
): List<String> = listOf(ownName) + members.map { it.trim() }.filterNot { it.equals(ownName, ignoreCase = true) }

/** The names in a config's usual roster, your own character's seat among them. */
internal fun standingRosterOf(partyId: Uuid): List<String> =
    PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
        .map { it[PartyMember.name] }

/** Every seat this party has ever had, retired and guest ones included, by lowercased name. */
internal fun seatIdsByName(partyId: Uuid): Map<String, Uuid> =
    PartyMember
        .selectAll()
        .where { PartyMember.partyId eq partyId }
        .associate { it[PartyMember.name].lowercase() to it[PartyMember.id] }

/** Your own characters by lowercased name. A seat naming one is linked to it and shows its sprite. */
internal fun ownCharacterIds(userId: String): Map<String, Uuid> =
    Characters
        .selectAll()
        .where { Characters.userId eq userId }
        // Names are unique per world, so this cannot bind somebody else's character.
        .associate { it[Characters.name].lowercase() to it[Characters.id] }

/**
 * What a seat starts out as: in the usual roster or a guest, and what it takes of a split.
 *
 * One value rather than two parameters because both are the seat's standing, and both are read from
 * the same place at every call.
 */
internal data class NewSeat(
    val standing: Boolean,
    val shares: Int = 1,
)

internal fun insertSeat(
    partyId: Uuid,
    name: String,
    characterId: Uuid?,
    seatPosition: Int,
    seat: NewSeat,
    context: SeatContext,
): Uuid {
    val seatId = Uuid.random()
    // Somebody else's real character, once an invite has linked them. This IS their membership of
    // the party, so it is written here rather than waiting for them to accept anything: see V75.
    val linked = if (characterId == null) context.linkedCharacters[name.lowercase()] else null
    // A seat that IS a character reads its sprite off that character, so no copy is kept here: a
    // copy would go stale the moment the character's own sprite is refreshed. True of a linked
    // person's character as much as of one of yours, their account being what refreshes it.
    val looked = characterId == null && linked == null && context.sprites.containsKey(name)
    PartyMember.insert {
        it[id] = seatId
        it[PartyMember.partyId] = partyId
        it[PartyMember.name] = name
        it[PartyMember.characterId] = characterId
        it[PartyMember.linkedCharacterId] = linked
        it[position] = seatPosition
        it[standing] = seat.standing
        it[shares] = seat.shares
        it[spriteImgUrl] = if (looked) context.sprites[name] else null
        it[spriteRefreshedAt] = if (looked) context.now else null
    }
    return seatId
}

/**
 * Takes these seats out of the usual roster without taking them out of the record.
 *
 * A seat that a payout or a week's roster points at is RETIRED rather than deleted. Both reference
 * it with ON DELETE CASCADE, so deleting it would erase a debt, or rewrite a week that has already
 * been played, silently and in the same breath as an ordinary roster edit.
 *
 * A seat nothing points at is deleted, so correcting a misspelled name on the day it was typed does
 * not leave the misspelling sitting in the party forever.
 */
internal fun retireOrDelete(
    partyId: Uuid,
    leaving: Collection<Uuid>,
) {
    if (leaving.isEmpty()) return
    val pinned = seatsWithLootHistory(partyId) + seatsInAnyWeekRoster(partyId)
    val (retire, remove) = leaving.partition { it in pinned }
    if (remove.isNotEmpty()) PartyMember.deleteWhere { PartyMember.id inList remove }
    if (retire.isNotEmpty()) PartyMember.update({ PartyMember.id inList retire }) { it[standing] = false }
}

/**
 * Why these standing share counts cannot be written, or null.
 *
 * A name the party does not have is refused rather than ignored: silently dropping it would leave
 * the party believing a seat takes double when nothing recorded it.
 */
internal fun validateShares(
    shares: Map<String, Int>,
    ownCharacterId: Uuid?,
    members: List<String>,
): String? {
    if (shares.isEmpty()) return null
    val named =
        (listOfNotNull(ownCharacterId?.let(::ownSeatName)) + members)
            .map { it.trim().lowercase() }
            .toSet()
    // Matched the way writeMembers matches them, or a name that differs only in case would be
    // counted as the one share it defaults to rather than the zero that was sent.
    val byName = shares.mapKeys { (name, _) -> name.trim().lowercase() }
    return when {
        byName.keys.any { it !in named } -> "shares may only name somebody in this party"
        // Zero is a seat that takes nothing, which some parties agree: one member keeps the drop
        // and owes the others nothing, because they are there for something else. See V44.
        byName.values.any { it < 0 || it > MAX_SHARES } -> "a share count must be between 0 and $MAX_SHARES"
        // Everybody on zero is not an arrangement. It divides the pot by nothing, and the roster
        // sent is the whole party, so no absent name is going to make up the difference.
        named.sumOf { byName[it] ?: 1 } < 1 -> "somebody in the party has to take a share"
        else -> null
    }
}

/**
 * The rules a config's roster has to keep, wherever it is being written.
 *
 * [allowNone] is for an EDIT, which has a config in hand to demote: taking the last other person
 * out of a party is how a boss you used to run with somebody becomes one you run alone, and
 * saveParty turns the config into the solo pool it now is rather than refusing the edit. Creating
 * one that names nobody has nothing to demote and is still refused: it would be a party of one on
 * the page that lists parties.
 */
internal fun validateMembers(
    members: List<String>,
    allowNone: Boolean = false,
): String? {
    val names = members.map { it.trim() }
    return when {
        // Your own character is the config; the members are the others. Nobody else means a solo
        // run, and a solo run is not a party.
        names.isEmpty() -> if (allowNone) null else "a party needs somebody else in it"
        names.size > MAX_PARTY_SIZE - 1 -> "a party holds at most $MAX_PARTY_SIZE including your character"
        names.any { it.isBlank() } -> "a member needs a character name"
        names.map { it.lowercase() }.distinct().size != names.size -> "the same character twice"
        else -> null
    }
}
