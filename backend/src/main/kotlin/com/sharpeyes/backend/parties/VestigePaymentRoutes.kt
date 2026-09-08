package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.VestigePayment
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// What a holder has actually PAID, as against what their pile owes: /api/vestige-payments.
//
// The other half of the piece ledger's one question. VestigeRoutes.kt records what happened to the
// coupons and the debt follows from it; this records the mesos coming back, which nothing else can
// know. Without it a pile whose every piece was sold and priced still read as outstanding, because
// "priced" and "paid" are different facts and only one of them had a box. See V51.
//
// No pieces on the row and no boss. A payment is against the holder's whole debt, and which boss it
// retires is the queue's answer, not something a human should have to type or this table should store.

/** The most one payment can be. A typo guard, the same shape as MAX_PIECES on a tranche. */
private const val MAX_AMOUNT = 1_000_000_000_000L

/** As long as a note may be, matching the check in V64 and the one an entered debt carries. */
private const val MAX_NOTE = 120

@Serializable
data class VestigePaymentResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    val receivedAt: String,
)

@Serializable
data class AddVestigePaymentRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
)

fun Route.vestigePaymentRoutes() {
    get { listPayments() }
    post { addPaymentRoute() }
    delete("/{paymentId}") { deletePaymentRoute() }
}

private suspend fun RoutingContext.listPayments() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        dbQuery {
            ensureUser(userId, email)
            paymentsFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addPaymentRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddVestigePaymentRequest>()
    val holder = request.holder.normalised()
    val note = request.note?.trim()?.takeIf { it.isNotEmpty() }

    val refusal = paymentRefusal(holder, request.amount, note)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val result =
        dbQuery {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            // Scoped to the account, which the foreign key does not do. See ownsPerson.
            if (holder.kind == "PERSON" && !ownsPerson(userId, person)) return@dbQuery null

            val now = Clock.System.now()
            VestigePayment.insert {
                it[id] = Uuid.random()
                it[VestigePayment.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[amount] = request.amount
                it[VestigePayment.note] = note
                it[receivedAt] = now
                it[createdAt] = now
            }
            paymentsFor(userId)
        }
    // The whole tally, like the tranche write: what a holder still owes is read off all of it, so a
    // client redrawing from the one row added would be guessing at the total.
    if (result == null) {
        call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
    } else {
        call.respond(HttpStatusCode.Created, result)
    }
}

private suspend fun RoutingContext.deletePaymentRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val paymentId = call.parseUuidParam("paymentId") ?: return
    val rows =
        dbQuery {
            ensureUser(userId, email)
            val gone =
                VestigePayment.deleteWhere {
                    (VestigePayment.id eq paymentId) and (VestigePayment.userId eq userId)
                } > 0
            if (gone) paymentsFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/**
 * Why this payment cannot be recorded, or null.
 *
 * Deliberately NOT checked against what the holder owes. The debt moves when an earlier week is
 * edited or a sale is corrected, so a payment refused for exceeding it would be a true fact the app
 * turned away, and one that became enterable again on the next edit. Overpayment is said on the card
 * instead, where it can be seen and corrected.
 */
internal fun paymentRefusal(
    holder: VestigeHolder,
    amount: Long,
    note: String? = null,
): String? =
    when {
        holder.kind !in setOf("PERSON", "SELF", "CHARACTER") ->
            "holder.kind must be one of PERSON, SELF, CHARACTER"
        // The kind and the reference cannot disagree, matching the checks in V51.
        (holder.kind == "PERSON") != (holder.personId != null) ->
            "a PERSON holder needs a personId, and nothing else does"
        (holder.kind == "CHARACTER") != (holder.characterName != null) ->
            "a CHARACTER holder needs a characterName, and nothing else does"
        holder.personId != null && runCatching { Uuid.parse(holder.personId) }.isFailure ->
            "personId is not an id"
        amount < 1 || amount > MAX_AMOUNT -> "amount must be between 1 and $MAX_AMOUNT"
        note != null && note.length > MAX_NOTE -> "note must be at most $MAX_NOTE characters"
        else -> null
    }

/**
 * Every payment this account has recorded, oldest first.
 *
 * Only the sum matters, so the order is for reading rather than for arithmetic. Oldest first anyway,
 * to match the tranche list the card draws beside it.
 *
 * Must run inside a transaction.
 */
internal fun paymentsFor(userId: String): List<VestigePaymentResponse> =
    VestigePayment
        .selectAll()
        .where { VestigePayment.userId eq userId }
        .orderBy(
            VestigePayment.receivedAt to SortOrder.ASC,
            VestigePayment.createdAt to SortOrder.ASC,
        ).map {
            val holder =
                VestigeHolder(
                    kind = it[VestigePayment.holderKind],
                    personId = it[VestigePayment.personId]?.toString(),
                    characterName = it[VestigePayment.characterName],
                )
            VestigePaymentResponse(
                id = it[VestigePayment.id].toString(),
                holder = holder,
                amount = it[VestigePayment.amount],
                note = it[VestigePayment.note],
                receivedAt = it[VestigePayment.receivedAt].toString(),
            )
        }
