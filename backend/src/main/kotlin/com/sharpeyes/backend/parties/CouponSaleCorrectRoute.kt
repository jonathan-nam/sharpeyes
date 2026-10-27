package com.sharpeyes.backend.parties

import com.sharpeyes.api.coupons.CorrectCouponSaleRequest
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update

// PUT /api/vestige-tranches/{trancheId}/amount. Registered by vestigeRoutes() with the rest of the
// ledger's tranche paths.

/**
 * Corrects what a coupon sale fetched. Only the price: its pieces and whose they were decide how the
 * queue spends it, so changing those is removing the sale and entering it again.
 *
 * The same rows deleteTrancheRoute may take back: this account's, not one a member wrote into it.
 */
internal suspend fun RoutingContext.correctTrancheRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val trancheId = call.parseUuidParam("trancheId") ?: return
    val request = call.receive<CorrectCouponSaleRequest>()

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val yours =
                (VestigeTranche.id eq trancheId) and (VestigeTranche.userId eq userId) and
                    (VestigeTranche.recordedByUserId.isNull() or (VestigeTranche.recordedByUserId eq userId))
            val row = VestigeTranche.selectAll().where { yours }.firstOrNull() ?: return@dbQuery null
            correctionRefusal(row[VestigeTranche.disposition], request.amount)?.let { return@dbQuery it }
            VestigeTranche.update({ yours }) { it[amount] = request.amount }
            tranchesFor(userId)
        }
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        else -> call.respond(outcome)
    }
}

/** Why a coupon sale of [disposition] cannot be repriced at [amount], or null. */
internal fun correctionRefusal(
    disposition: String,
    amount: Long,
): String? =
    when {
        disposition !in PRICED -> "A kept stack has no price to correct."
        amount < 1 -> "A sale needs an amount above zero. A stack that fetched nothing is kept."
        else -> null
    }
