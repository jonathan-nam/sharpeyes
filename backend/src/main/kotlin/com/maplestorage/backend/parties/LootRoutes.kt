package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The loot pool, under an owned party: /api/parties/{id}/loot. Plus the wallet's settle, which is
// the one handler here that is NOT under a party (see settleRoute), registered by PartyRoutes.kt.
//
// Every handler starts by proving the party is the caller's. Nothing here trusts a loot id on its
// own, since a loot row's owner is its party's owner and nothing else.

fun Route.lootRoutes() {
    get { listLoot() }
    post { addLootRoute() }
    put("/{lootId}/sale") { sellLootRoute() }
    delete("/{lootId}/sale") { unsellLootRoute() }
    put("/{lootId}/taken") { setTakenRoute() }
    put("/{lootId}/payouts/{memberId}") { setPayoutRoute() }
    put("/{lootId}/bundles") { setBundlesRoute() }
    delete("/{lootId}") { deleteLootRoute() }
}

private suspend fun RoutingContext.listLoot() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val loot =
        transaction {
            ensureUser(userId, email)
            if (!ownsParty(partyId, userId)) null else lootFor(partyId)
        }
    if (loot == null) call.respond(HttpStatusCode.NotFound) else call.respond(loot)
}

private suspend fun RoutingContext.addLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<AddLootRequest>()
    val droppedOn = parseDroppedOn(request.droppedOn) ?: return
    val customName = request.customName?.trim()?.ifBlank { null }

    // Caught OUTSIDE the transaction, which is what rolls the insert back with the refusal: an
    // arrangement sent with a drop is part of the same act, so neither lands or both do.
    val outcome =
        try {
            transaction {
                ensureUser(userId, email)
                val dropId = request.dropKey?.let { dropIdForKey(it) }
                val bossId = request.bossKey?.let { bossIdForKey(it) }
                when {
                    !ownsParty(partyId, userId) -> null
                    // Exactly one name. Both would leave two answers to "what is this?", neither
                    // would leave a blank row.
                    (request.dropKey == null) == (customName == null) ->
                        "send exactly one of dropKey or customName"
                    request.dropKey != null && dropId == null -> "unknown dropKey"
                    request.bossKey != null && bossId == null -> "unknown bossKey"
                    else ->
                        addedDrop(
                            partyId,
                            request,
                            LootedDrop(dropId, customName, request.quantity),
                            bossId,
                            droppedOn,
                        )
                }
            }
        } catch (refused: BundlesRefused) {
            refused.reason
        }
    respondToLoot(outcome, HttpStatusCode.Created)
}

private suspend fun RoutingContext.sellLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return
    val request = call.receive<SellLootRequest>()
    val sellerId = Uuid.parseOrNull(request.sellerMemberId)

    val outcome =
        transaction {
            ensureUser(userId, email)
            val loot = findLoot(lootId, partyId)
            when {
                !ownsParty(partyId, userId) -> null
                loot == null -> null
                !partyCanSell(partyId) -> "Heroic worlds do not trade, so this cannot be sold."
                request.amount < 0 -> "amount must be zero or more"
                request.amountBasis !in AMOUNT_BASES ->
                    "amountBasis must be LISTED, RECEIVED or BOUGHT"
                request.splitMethod !in SPLIT_METHODS -> "splitMethod must be LAZY or FAIR"
                // The seller has to have been THERE: they are who the payouts are measured against,
                // and somebody who did not run that week would make every share wrong. Off the
                // drop's own row, which is the same list the seller select offers.
                sellerId == null || sellerId.toString() !in loot.ranThatWeek ->
                    "sellerMemberId must be somebody who ran this boss that week"
                sharesRefusal(request.shares, loot.ranThatWeek) != null ->
                    sharesRefusal(request.shares, loot.ranThatWeek)
                else -> {
                    sellLoot(lootId, request, sellerId, partyId, Clock.System.now())
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}

private suspend fun RoutingContext.unsellLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return

    val outcome =
        transaction {
            ensureUser(userId, email)
            when {
                !ownsParty(partyId, userId) -> null
                findLoot(lootId, partyId) == null -> null
                else -> {
                    unsellLoot(lootId, Clock.System.now())
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}

private suspend fun RoutingContext.setPayoutRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val ids = call.parseUuidParams("id", "lootId", "memberId") ?: return
    val (partyId, lootId, memberId) = ids
    val request = call.receive<PayoutRequest>()

    val outcome =
        transaction {
            ensureUser(userId, email)
            when {
                !ownsParty(partyId, userId) -> null
                findLoot(lootId, partyId) == null -> null
                // No row means this member is not on the drop's pinned roster: they joined after
                // it sold, or they are the seller. Either way there is nothing owed to mark.
                !setPayoutPaid(lootId, memberId, request.paid, Clock.System.now()) -> null
                else -> findLoot(lootId, partyId)!!
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}

/**
 * Settles a whole relationship: every payout row one net transfer covers, marked paid together.
 *
 * Account-wide rather than under /{id}/loot, because a relationship is not one party's. Paying
 * somebody once for four drops across three of your characters' parties is one transfer, and four
 * requests would let three land and the fourth fail with no record of which.
 *
 * Answers with every pool, the shape GET /loot returns, so the wallet redraws from the server's
 * reading of what is now paid rather than from what it assumed would happen.
 */
internal suspend fun RoutingContext.settleRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SettleRequest>()
    val refs = request.payouts.map { Uuid.parseOrNull(it.lootId) to Uuid.parseOrNull(it.memberId) }

    if (refs.isEmpty()) {
        return call.respond(HttpStatusCode.BadRequest, "name at least one payout to settle")
    }
    if (refs.any { (lootId, memberId) -> lootId == null || memberId == null }) {
        return call.respond(HttpStatusCode.BadRequest, "malformed lootId or memberId")
    }

    val named = refs.map { (lootId, memberId) -> lootId!! to memberId!! }
    val pools =
        transaction {
            ensureUser(userId, email)
            if (settlePayouts(userId, named, Clock.System.now())) allLootFor(userId) else null
        }
    if (pools == null) {
        // Nothing was written: see settlePayouts. Reload rather than retry, since a wallet naming
        // a row that is gone is reading a pool that has moved on.
        call.respond(HttpStatusCode.NotFound, "a drop or member named here is not in your parties any more")
    } else {
        call.respond(pools)
    }
}

private suspend fun RoutingContext.deleteLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return

    val deleted =
        transaction {
            ensureUser(userId, email)
            ownsParty(partyId, userId) && deleteLoot(lootId, partyId)
        }
    call.respond(if (deleted) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
}

/** All three path ids at once, so a handler that needs them keeps to one early return. */
private suspend fun ApplicationCall.parseUuidParams(vararg names: String): List<Uuid>? {
    val parsed = names.map { parameters[it]?.let(Uuid::parseOrNull) }
    if (parsed.any { it == null }) {
        val bad = names.filterIndexed { i, _ -> parsed[i] == null }.joinToString(", ")
        respond(HttpStatusCode.BadRequest, "malformed $bad")
        return null
    }
    return parsed.filterNotNull()
}

/** null is a 404, a String is a refusal with its reason, a LootResponse is the answer. */
internal suspend fun RoutingContext.respondToLoot(
    outcome: Any?,
    onSuccess: HttpStatusCode,
) {
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        is LootResponse -> call.respond(onSuccess, outcome)
        else -> call.respond(HttpStatusCode.InternalServerError)
    }
}
