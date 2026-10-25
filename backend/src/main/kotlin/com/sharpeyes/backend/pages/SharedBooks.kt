package com.sharpeyes.backend.pages

import com.sharpeyes.api.coupons.VestigeHolder
import com.sharpeyes.api.pages.SharedPartiesResponse
import com.sharpeyes.backend.db.PartyReadCutoff
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.invites.senderNameFor
import com.sharpeyes.backend.parties.PERSON
import com.sharpeyes.backend.parties.SELF
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.clashesIn
import com.sharpeyes.backend.parties.debtsFor
import com.sharpeyes.backend.parties.disposalsFor
import com.sharpeyes.backend.parties.imageOf
import com.sharpeyes.backend.parties.partiesFor
import com.sharpeyes.backend.parties.paymentsFor
import com.sharpeyes.backend.parties.settlementsFor
import com.sharpeyes.backend.parties.standingParties
import com.sharpeyes.backend.parties.tranchesFor
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// What somebody else's book says about you, so your Settlement page can show it from your side.
//
// The book stays in its owner's account (docs/shared-parties-plan.md). This reads it AS the owner,
// cut to the pair: the parties with a seat the owner files under your person row, and the rows that
// name you. The client runs the same buildSettlement over it and flips your row, so the two cards
// cannot come out of different arithmetic. Inside a transaction, like the rest.

/** Every book that has a person row linked to [userId]'s account, cut to that pair. */
internal fun sharedBooksFor(userId: String): List<SharedPartiesResponse> =
    Person
        .selectAll()
        .where { Person.linkedUserId eq userId }
        .map { it[Person.userId] to it[Person.id] }
        .filter { (owner, _) -> owner != userId }
        .map { (owner, personId) -> bookBetween(owner, userId, personId.toString()) }
        .filter { it.parties.isNotEmpty() || it.debts.isNotEmpty() || it.payments.isNotEmpty() }

internal fun bookBetween(
    owner: String,
    member: String,
    personId: String,
): SharedPartiesResponse {
    val names = { holder: VestigeHolder -> holder.kind == PERSON && holder.personId == personId }
    val selfOrYou = { holder: VestigeHolder -> holder.kind == SELF || names(holder) }
    val reads = CrossRead(owner, member, personId)
    val after = reads::after

    // The parties where a seat is yours as the owner files it. Those are the only nights your card
    // in their book is made of; the rest of their account says nothing about you.
    val parties =
        partiesFor(owner, week = null, includeSolo = true, includeRetired = true)
            .filter { party -> party.seats.any { it.personId == personId } && reads.party(party.id) }
    val ids = parties.map { it.id }.toSet()
    val lootIds = mutableSetOf<String>()
    val pools =
        // Who logged each drop is answered as the member: the one who logged it is who sells it.
        allLootFor(owner, viewer = member)
            .filter { it.partyId in ids }
            .map { pool -> pool.copy(loot = pool.loot.filter { reads.drop(pool.partyId, it.droppedOn) }) }
            .onEach { pool -> pool.loot.forEach { lootIds += it.id } }

    // Their own pile's sales stay whole, because a sale out of it re-prices every coupon in it, but
    // a share naming somebody else is not yours to read. A sale out of your pile is yours.
    val tranches =
        // Read as the member throughout, so each row says whether they wrote it. See V88.
        tranchesFor(owner, viewer = member)
            .filter { (it.holder.kind == SELF || names(it.holder)) && after(it.soldAt) }
            .map { tranche -> tranche.copy(shares = tranche.shares.filter { selfOrYou(it.holder) }) }
    val settlements =
        settlementsFor(owner)
            .filter { selfOrYou(it.holder) && after(it.settledAt) }
            .map { it.copy(lootIds = it.lootIds.filter { id -> id in lootIds }) }
            .filter { names(it.holder) || it.lootIds.isNotEmpty() }

    val yours = personFor(member, owner)
    return SharedPartiesResponse(
        ownerName = yours?.get(Person.name) ?: senderNameFor(owner) ?: "Party owner",
        ownerImage = imageOf(owner),
        personId = personId,
        ownerPersonId = yours?.get(Person.id)?.toString(),
        parties = parties,
        pools = pools,
        tranches = tranches,
        payments = paymentsFor(owner, viewer = member).filter { names(it.holder) && after(it.receivedAt) },
        settlements = settlements,
        debts = debtsFor(owner, viewer = member).filter { names(it.holder) && after(it.incurredAt) },
        disposals = disposalsFor(owner, viewer = member).filter { names(it.holder) && after(it.decidedAt) },
    )
}

/** The length of "2026-10-24", the date at the head of every ISO date or instant this compares. */
private const val ISO_DATE = 10

/**
 * What [member] reads of [owner]'s book, so a night both books logged is counted once.
 *
 * Nothing from before the two books met (V99): everything dated earlier is already in the reader's
 * own book, or was never theirs to count. Every kind alike, or a debt would be read without the
 * payment that settled it. A combined party is read from its cutoff, the one retired into it not at
 * all, and one still overlapping a party of the member's not at all until the two are combined. See
 * CombineParties.kt.
 */
private class CrossRead(
    owner: String,
    member: String,
    personId: String,
) {
    private val linkFrom =
        Person
            .selectAll()
            .where { Person.id eq Uuid.parse(personId) }
            .firstOrNull()
            ?.get(Person.sharedFrom)
    private val cutoffs = readCutoffsFor(member)
    private val overlapping = overlappingParties(owner, member)

    fun after(date: String) = linkFrom == null || date.take(ISO_DATE) >= linkFrom.toString()

    fun party(id: String) = id !in overlapping && !(cutoffs.containsKey(id) && cutoffs[id] == null)

    fun drop(
        partyId: String,
        droppedOn: String,
    ): Boolean {
        val from = cutoffs[partyId]
        return (from == null || LocalDate.parse(droppedOn) >= from) && after(droppedOn)
    }
}

/**
 * [owner]'s standing parties that share a character with one of [reader]'s for the same boss: two
 * pools for one night until the owners combine them, so neither is read across. See CombineSeats.kt.
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

/** [member]'s own person row for [owner]'s account, if they have one. */
private fun personFor(
    member: String,
    owner: String,
) = Person
    .selectAll()
    .where { (Person.userId eq member) and (Person.linkedUserId eq owner) }
    .firstOrNull()

/** GET /api/pages/shared-books. */
internal suspend fun RoutingContext.sharedBooksPage() {
    val (userId, email) = call.principalIdAndEmail()
    val books =
        dbQuery {
            ensureUser(userId, email)
            sharedBooksFor(userId)
        }
    call.respond(books)
}
