package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Selling a pile of one interchangeable drop in one go: POST /api/parties/loot/lot, registered by
// PartyRoutes.kt.
//
// Not in LootRoutes.kt with the rest, for LootLogRoute.kt's reason: every handler there starts by
// proving a party id in the PATH is the caller's, and a lot has no one party. It spans as many pools
// as it has rows, and each is proved separately.

/**
 * Prices every row of a lot, or none of them.
 *
 * Account-wide, for settleRoute's reason: four grindstones can be four rows in four pools, and four
 * requests would let three land and the fourth fail with the lot half priced and nothing on screen
 * saying which half.
 *
 * The rows are the ones the user confirmed, sent back. Nothing here works out which rows a lot
 * covers: a server that re-derived "the oldest unsold rows" could sell rows the preview never
 * showed, the moment a tab is stale or two are open, and the sale would land on a party that never
 * made it. See LotSaleRequest.
 *
 * Answers with every pool, the shape GET /loot returns, so the page redraws from what is now stored
 * rather than from the proposal it sent.
 */
internal suspend fun RoutingContext.lotSaleRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<LotSaleRequest>()
    val parsed =
        request.rows.map { row ->
            val partyId = Uuid.parseOrNull(row.partyId)
            val lootId = Uuid.parseOrNull(row.lootId)
            val sellerId = Uuid.parseOrNull(row.sellerMemberId)
            if (partyId == null || lootId == null || sellerId == null) {
                null
            } else {
                LotRow(partyId, lootId, row.amount, sellerId, row.shares)
            }
        }

    if (parsed.any { it == null }) {
        return call.respond(HttpStatusCode.BadRequest, "malformed partyId, lootId or sellerMemberId")
    }
    val rows = parsed.map { it!! }
    // About the lot rather than any one row, and needing no database. The per-row rules are sellLot's,
    // so they are checked in the same transaction that writes them.
    lotRequestRefusal(request, rows)?.let { return call.respond(HttpStatusCode.BadRequest, it) }

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            sellLot(userId, request.dropKey, request.amountBasis, request.splitMethod, rows, Clock.System.now())
                ?: allLootFor(userId)
        }
    if (outcome is String) {
        call.respond(HttpStatusCode.BadRequest, outcome)
    } else {
        call.respond(outcome)
    }
}
