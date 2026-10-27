package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.LootResponse
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyReadCutoff
import com.sharpeyes.backend.db.Person
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// What a member reads of a party somebody else owns, and whose side they read it from. Every member
// read goes through here (the shared books, Party View's joined pools, the party page, the counts),
// so no two screens can show a member different history or reckon a share from different seats.
// Inside a transaction, like the rest.

/**
 * What [member] reads of [owner]'s book, so a night both books logged is counted once.
 *
 * Nothing from before the two accounts were linked (V99): everything dated earlier is already in the
 * reader's own book, or was never theirs to count. Every kind alike, or a debt would be read without
 * the payment that settled it. A party overlapping one of the member's is not read at all. A party
 * combined while that existed (V98) is read from its PartyReadCutoff, the one retired into it not at
 * all.
 */
internal class MemberReads(
    owner: String,
    member: String,
    personId: Uuid? = linkedPersonId(owner, member),
) {
    private val linkFrom =
        personId?.let { id ->
            Person
                .selectAll()
                .where { Person.id eq id }
                .firstOrNull()
                ?.get(Person.sharedFrom)
        }
    private val cutoffs = readCutoffsFor(member)
    private val overlapping = overlappingParties(owner, member)

    fun after(date: String) = linkFrom == null || date.take(ISO_DATE) >= linkFrom.toString()

    fun party(id: String) = id !in overlapping && !(cutoffs.containsKey(id) && cutoffs[id] == null)

    fun drop(
        partyId: String,
        droppedOn: String,
    ): Boolean {
        val from = cutoffs[partyId]
        return party(partyId) && (from == null || LocalDate.parse(droppedOn) >= from) && after(droppedOn)
    }
}

/**
 * The seats [reader] reads [partyIds] from: the owner's characters for their own parties, their own
 * seats in one somebody else owns. What "your share" and "paid out" are reckoned against.
 */
internal fun readerSeatsIn(
    partyIds: List<Uuid>,
    reader: String,
): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    val owners = ownersOf(partyIds)
    val own = partyIds.filter { owners[it] == reader }
    return ownSeatsIn(own) + partyIds.filter { owners[it] != reader }.flatMap { mySeatsIn(it, reader) }
}

/** Each party's owner, by id. */
internal fun ownersOf(partyIds: List<Uuid>): Map<Uuid, String> =
    if (partyIds.isEmpty()) {
        emptyMap()
    } else {
        Party
            .selectAll()
            .where { Party.id inList partyIds }
            .associate { it[Party.id] to it[Party.userId] }
    }

/**
 * Whether [reader] reads each drop, given its party and the day it fell. Always true in a party they
 * own; a member's goes through [MemberReads], built once per owner.
 */
internal fun dropsReadBy(
    reader: String,
    partyIds: List<Uuid>,
): (Uuid, LocalDate) -> Boolean {
    val owners = ownersOf(partyIds)
    val others = owners.values.filter { it != reader }.toSet()
    val reads = others.associateWith { MemberReads(it, reader) }
    return { partyId, droppedOn ->
        val owner = owners[partyId]
        owner == reader || reads[owner]?.drop(partyId.toString(), droppedOn.toString()) ?: false
    }
}

/** [loot] cut to what [reader] reads of [partyId]'s pool. See [MemberReads]. */
internal fun List<LootResponse>.readBy(
    reader: String,
    partyId: Uuid,
): List<LootResponse> {
    val reads = dropsReadBy(reader, listOf(partyId))
    return filter { reads(partyId, LocalDate.parse(it.droppedOn)) }
}

/** [member]'s person row in [owner]'s list: who the owner says they are. Null when never linked. */
private fun linkedPersonId(
    owner: String,
    member: String,
): Uuid? =
    Person
        .selectAll()
        .where { (Person.userId eq owner) and (Person.linkedUserId eq member) }
        .firstOrNull()
        ?.get(Person.id)

/**
 * [owner]'s standing parties that share a character with one of [reader]'s for the same boss: two
 * pools for one night, so neither is read across. See StandingParties.kt.
 */
private fun overlappingParties(
    owner: String,
    reader: String,
): Set<String> =
    clashesIn(standingParties(listOf(owner, reader)))
        .filter { clash ->
            clash.holders
                .map { it.owner }
                .toSet()
                .size > 1
        }.flatMap { clash -> clash.holders.filter { it.owner == owner }.map { it.id.toString() } }
        .toSet()

/** Each party [reader] reads only part of, by id: from that date on, or none of it when null. */
private fun readCutoffsFor(reader: String): Map<String, LocalDate?> =
    PartyReadCutoff
        .selectAll()
        .where { PartyReadCutoff.userId eq reader }
        .associate { it[PartyReadCutoff.partyId].toString() to it[PartyReadCutoff.sharedFrom] }

/** The length of "2026-10-24", the date at the head of every ISO date or instant this compares. */
private const val ISO_DATE = 10
