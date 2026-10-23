package com.sharpeyes.backend.pages

import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.invites.senderNameFor
import com.sharpeyes.backend.parties.PERSON
import com.sharpeyes.backend.parties.SELF
import com.sharpeyes.backend.parties.VestigeHolder
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.debtsFor
import com.sharpeyes.backend.parties.disposalsFor
import com.sharpeyes.backend.parties.imageOf
import com.sharpeyes.backend.parties.partiesFor
import com.sharpeyes.backend.parties.paymentsFor
import com.sharpeyes.backend.parties.settlementsFor
import com.sharpeyes.backend.parties.tranchesFor
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll

// What somebody else's book says about you, so your Settlement page can show it from your side.
//
// The book stays in its owner's account (docs/shared-parties-plan.md). This reads it AS the owner,
// cut to the pair: the parties with a seat the owner files under your person row, and the rows that
// name you. The client runs the same buildSettlement over it and flips your row, so the two cards
// cannot come out of different arithmetic. Inside a transaction, like the rest.

/** Every book that has a person row linked to [userId]'s account, cut to that pair. */
internal fun sharedBooksFor(userId: String): List<SharedBookResponse> =
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
): SharedBookResponse {
    val names = { holder: VestigeHolder -> holder.kind == PERSON && holder.personId == personId }
    val selfOrYou = { holder: VestigeHolder -> holder.kind == SELF || names(holder) }

    // The parties where a seat is yours as the owner files it. Those are the only nights your card
    // in their book is made of; the rest of their account says nothing about you.
    val parties =
        partiesFor(owner, week = null, includeSolo = true, includeRetired = true)
            .filter { party -> party.seats.any { it.personId == personId } }
    val ids = parties.map { it.id }.toSet()
    val lootIds = mutableSetOf<String>()
    val pools =
        // Who logged each drop is answered as the member: the one who logged it is who sells it.
        allLootFor(owner, viewer = member)
            .filter { it.partyId in ids }
            .onEach { pool -> pool.loot.forEach { lootIds += it.id } }

    // Their own pile's sales stay whole, because a sale out of it re-prices every coupon in it, but
    // a share naming somebody else is not yours to read. A sale out of your pile is yours.
    val tranches =
        // Read as the member throughout, so each row says whether they wrote it. See V88.
        tranchesFor(owner, viewer = member)
            .filter { it.holder.kind == SELF || names(it.holder) }
            .map { tranche -> tranche.copy(shares = tranche.shares.filter { selfOrYou(it.holder) }) }
    val settlements =
        settlementsFor(owner)
            .filter { selfOrYou(it.holder) }
            .map { it.copy(lootIds = it.lootIds.filter { id -> id in lootIds }) }
            .filter { names(it.holder) || it.lootIds.isNotEmpty() }

    val yours = personFor(member, owner)
    return SharedBookResponse(
        ownerName = yours?.get(Person.name) ?: senderNameFor(owner) ?: "Party owner",
        ownerImage = imageOf(owner),
        personId = personId,
        ownerPersonId = yours?.get(Person.id)?.toString(),
        parties = parties,
        pools = pools,
        tranches = tranches,
        payments = paymentsFor(owner, viewer = member).filter { names(it.holder) },
        settlements = settlements,
        debts = debtsFor(owner, viewer = member).filter { names(it.holder) },
        disposals = disposalsFor(owner, viewer = member).filter { names(it.holder) },
    )
}

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
