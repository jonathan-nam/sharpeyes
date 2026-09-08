package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.VestigeProceedsDisposal
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

// What became of the money from selling somebody else's coupons: /api/proceeds-disposals.
//
// Selling a tranche of Bro's coupons out of your own pile leaves you holding Bro's money. Two things
// can happen to it and they end in different places: it comes off what he owes you, or you send it to
// him and his debt does not move. Since V56 the card did the first one silently, which is the app
// deciding something only the two of them can. See V61.
//
// A RUNNING FIGURE per holder. What is undecided is what you have sold of theirs less what has been
// disposed of, so a sale entered next week is undecided the moment it lands and no row here has to be
// re-pointed at it.

/** The most one act can dispose of. A typo guard, matching the payment ceiling. */
private const val MAX_AMOUNT = 1_000_000_000_000L

private const val OFFSET = "OFFSET"
private const val PAID = "PAID"

@Serializable
data class ProceedsDisposalResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    /** OFFSET: it came off their debt. PAID: you sent it to them. */
    val kind: String,
    val decidedAt: String,
)

@Serializable
data class AddProceedsDisposalRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val kind: String,
)

fun Route.proceedsDisposalRoutes() {
    get { listDisposals() }
    post { addDisposalRoute() }
    delete("/{disposalId}") { deleteDisposalRoute() }
}

private suspend fun RoutingContext.listDisposals() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        dbQuery {
            ensureUser(userId, email)
            disposalsFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addDisposalRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddProceedsDisposalRequest>()
    val holder = request.holder.normalised()

    val refusal = disposalRefusal(holder, request.amount, request.kind)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val result =
        dbQuery {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            // Scoped to the account, which the foreign key does not do. See ownsPerson.
            if (holder.kind == "PERSON" && !ownsPerson(userId, person)) return@dbQuery null

            val now = Clock.System.now()
            VestigeProceedsDisposal.insert {
                it[id] = Uuid.random()
                it[VestigeProceedsDisposal.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[amount] = request.amount
                it[kind] = request.kind
                it[decidedAt] = now
                it[createdAt] = now
            }
            disposalsFor(userId)
        }
    // The whole list, like every other write on this ledger: what is left undecided is read off all of
    // it, so a client redrawing from the one row added would be guessing at the total.
    if (result == null) {
        call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
    } else {
        call.respond(HttpStatusCode.Created, result)
    }
}

private suspend fun RoutingContext.deleteDisposalRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val disposalId = call.parseUuidParam("disposalId") ?: return
    val rows =
        dbQuery {
            ensureUser(userId, email)
            val gone =
                VestigeProceedsDisposal.deleteWhere {
                    (VestigeProceedsDisposal.id eq disposalId) and
                        (VestigeProceedsDisposal.userId eq userId)
                } > 0
            if (gone) disposalsFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/**
 * Why this decision cannot be recorded, or null.
 *
 * Deliberately NOT checked against what you are actually holding of theirs. That figure moves when a
 * sale is corrected or an earlier week is edited, so an act refused for exceeding it would be a true
 * fact the app turned away, and one that became enterable again on the next edit. The same reasoning
 * as paymentRefusal. Disposing of more than you hold is said on the card, where it can be seen.
 */
internal fun disposalRefusal(
    holder: VestigeHolder,
    amount: Long,
    kind: String,
): String? =
    when {
        holder.kind !in setOf("PERSON", "SELF", "CHARACTER") ->
            "holder.kind must be one of PERSON, SELF, CHARACTER"
        kind !in setOf(OFFSET, PAID) -> "kind must be one of $OFFSET, $PAID"
        // The kind and the reference cannot disagree, matching the checks in V61.
        (holder.kind == "PERSON") != (holder.personId != null) ->
            "a PERSON holder needs a personId, and nothing else does"
        (holder.kind == "CHARACTER") != (holder.characterName != null) ->
            "a CHARACTER holder needs a characterName, and nothing else does"
        holder.personId != null && runCatching { Uuid.parse(holder.personId) }.isFailure ->
            "personId is not an id"
        // Your own pile owes you nothing, so there is no money of yours for you to decide about.
        holder.kind == "SELF" -> "there is nothing of your own to offset or pay out"
        amount < 1 || amount > MAX_AMOUNT -> "amount must be between 1 and $MAX_AMOUNT"
        else -> null
    }

/**
 * Every decision this account has recorded, oldest first.
 *
 * Only the sum matters, so the order is for reading rather than for arithmetic. Oldest first to match
 * the payments and tranches the card draws beside them.
 *
 * Must run inside a transaction.
 */
internal fun disposalsFor(userId: String): List<ProceedsDisposalResponse> =
    VestigeProceedsDisposal
        .selectAll()
        .where { VestigeProceedsDisposal.userId eq userId }
        .orderBy(
            VestigeProceedsDisposal.decidedAt to SortOrder.ASC,
            VestigeProceedsDisposal.createdAt to SortOrder.ASC,
        ).map {
            val holder =
                VestigeHolder(
                    kind = it[VestigeProceedsDisposal.holderKind],
                    personId = it[VestigeProceedsDisposal.personId]?.toString(),
                    characterName = it[VestigeProceedsDisposal.characterName],
                )
            ProceedsDisposalResponse(
                id = it[VestigeProceedsDisposal.id].toString(),
                holder = holder,
                amount = it[VestigeProceedsDisposal.amount],
                kind = it[VestigeProceedsDisposal.kind],
                decidedAt = it[VestigeProceedsDisposal.decidedAt].toString(),
            )
        }
