package com.sharpeyes.backend.parties

import com.sharpeyes.api.coupons.VestigeTrancheShareRow
import com.sharpeyes.api.events.EventTarget
import com.sharpeyes.api.settlement.SharedDisposalRequest
import com.sharpeyes.api.settlement.SharedMoneyRequest
import com.sharpeyes.api.settlement.SharedTrancheRequest
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.tellLinkedOnWrite
import com.sharpeyes.backend.pages.bookBetween
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlin.time.Clock
import kotlin.uuid.Uuid

// /api/shared-books/{personId}/...: a member's writes into the owner's book, where {personId} is the
// member's person row on the owner's account (SharedBookResponse.personId). Each answers with that
// book re-read, from the member's side. See SharedBookWrites.kt.

fun Route.sharedBookRoutes() {
    // The owner's Settlement card moves, and so does the member's own.
    tellLinkedOnWrite(Topic.SETTLEMENT, Topic.LOOT) { EventTarget(person = it.parameters["personId"]) }
    route("/{personId}") {
        post("/tranches") { addTranche() }
        post("/debts") { addMoney(SharedRow.DEBT) }
        post("/payments") { addMoney(SharedRow.PAYMENT) }
        delete("/tranches/{rowId}") { remove(SharedRow.TRANCHE) }
        delete("/debts/{rowId}") { remove(SharedRow.DEBT) }
        delete("/payments/{rowId}") { remove(SharedRow.PAYMENT) }
        post("/disposals") { addDisposal() }
        delete("/disposals/{rowId}") { remove(SharedRow.DISPOSAL) }
    }
}

private suspend fun RoutingContext.addDisposal() {
    val request = call.receive<SharedDisposalRequest>()
    inBook { book, writer ->
        disposalRefusal(book.holder, request.amount, request.kind, request.heldBy) ?: run {
            insertSharedDisposal(book, writer, request.amount, request.kind, request.heldBy, Clock.System.now())
            null
        }
    }
}

/** Runs [write] against the book at {personId} as the caller, or 404s when it is not theirs to write. */
private suspend fun RoutingContext.inBook(write: (SharedBook, String) -> String?) {
    val (userId, email) = call.principalIdAndEmail()
    val personId = call.parameters["personId"]?.let(Uuid::parseOrNull)
    val outcome =
        personId?.let {
            dbQuery {
                ensureUser(userId, email)
                val book = sharedBookAt(it, userId) ?: return@dbQuery null
                write(book, userId)?.let { refusal -> Result.failure(IllegalArgumentException(refusal)) }
                    ?: Result.success(bookBetween(book.owner, userId, it.toString()))
            }
        }
    when {
        outcome == null -> call.respond(HttpStatusCode.NotFound)
        outcome.isFailure -> call.respond(HttpStatusCode.BadRequest, outcome.exceptionOrNull()!!.message!!)
        else -> call.respond(outcome.getOrThrow())
    }
}

private suspend fun RoutingContext.addTranche() {
    val request = call.receive<SharedTrancheRequest>()
    val disposition = request.disposition.trim().uppercase()
    val shares = request.shares.map { VestigeTrancheShareRow(it.holder.normalised(), it.pieces) }
    inBook { book, writer ->
        trancheRefusal(book.holder, request.pieces, request.amount, disposition)
            ?: shareRefusal(book.holder, request.pieces, disposition, shares)
            // A creditor is somebody on the OWNER's list, or the owner themself (SELF).
            ?: shares
                .firstOrNull {
                    it.holder.kind == PERSON &&
                        !ownsPerson(book.owner, it.holder.personId?.let(Uuid::parseOrNull))
                }?.let { "a share names somebody who is not in this book" }
            ?: run {
                insertSharedTranche(
                    book,
                    writer,
                    TrancheEntry(request.pieces, request.amount, disposition, shares),
                    Clock.System.now(),
                )
                null
            }
    }
}

private suspend fun RoutingContext.addMoney(kind: SharedRow) {
    val request = call.receive<SharedMoneyRequest>()
    val note = request.note?.trim()?.takeIf { it.isNotEmpty() }
    inBook { book, writer ->
        val refusal =
            if (kind == SharedRow.DEBT) {
                debtRefusal(book.holder, request.amount, note)
            } else {
                paymentRefusal(book.holder, request.amount, note)
            }
        refusal ?: run {
            val now = Clock.System.now()
            if (kind == SharedRow.DEBT) {
                insertSharedDebt(book, writer, request.amount, note, now)
            } else {
                insertSharedPayment(book, writer, request.amount, note, now)
            }
            null
        }
    }
}

private suspend fun RoutingContext.remove(kind: SharedRow) {
    val rowId = call.parameters["rowId"]?.let(Uuid::parseOrNull)
    inBook { book, writer ->
        if (rowId != null && deleteSharedRow(book, writer, kind, rowId)) null else "Only rows you added can be removed."
    }
}
