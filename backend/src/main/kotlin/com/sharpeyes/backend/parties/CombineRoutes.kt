package com.sharpeyes.backend.parties

import com.sharpeyes.api.combine.CombinePreviewResponse
import com.sharpeyes.api.combine.SendCombineRequest
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.refuse
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
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// /api/party-combines: Social's Combine Parties. Every write answers with the whole list. See CombineParties.kt.

fun Route.combineRoutes() {
    get { respondPage() }
    post { sendRoute() }
    // The characters left to place once the pairs are chosen. Writes nothing.
    post("/preview") { previewRoute() }
    post("/{id}/accept") { write { userId, now -> idParam()?.let { acceptCombine(userId, it, now) } } }
    // Declined by the other owner, or withdrawn by the one who asked.
    delete("/{id}") {
        write { userId, _ ->
            idParam()?.let { if (dropCombine(userId, it)) CombineAnswer.Done else CombineAnswer.NotFound }
        }
    }
}

private fun RoutingContext.idParam() = call.parameters["id"]?.let(Uuid::parseOrNull)

private suspend fun RoutingContext.respondPage() {
    val (userId, email) = call.principalIdAndEmail()
    call.respond(
        dbQuery {
            ensureUser(userId, email)
            combinePage(userId, Clock.System.now())
        },
    )
}

private fun SendCombineRequest.parsedChoices() =
    choices.mapNotNull { choice ->
        val mine = Uuid.parseOrNull(choice.mine)
        val theirs = Uuid.parseOrNull(choice.theirs)
        val keep = Uuid.parseOrNull(choice.keepPartyId)
        if (mine == null || theirs == null || keep == null) null else CombineChoice(mine, theirs, keep)
    }

private suspend fun RoutingContext.sendRoute() {
    val body = call.receive<SendCombineRequest>()
    val person = Uuid.parseOrNull(body.personId)
    val seats = body.seats.mapNotNull { seat -> Uuid.parseOrNull(seat.keepPartyId)?.let { SeatChoice(seat.name, it) } }
    write { userId, now -> person?.let { sendCombine(userId, it, body.parsedChoices(), seats, now) } }
}

/** POST /api/party-combines/preview: the body a send would take, minus the seats. */
private suspend fun RoutingContext.previewRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val body = call.receive<SendCombineRequest>()
    val person = Uuid.parseOrNull(body.personId)
    val clashes =
        person?.let {
            dbQuery {
                ensureUser(userId, email)
                previewCombine(userId, it, body.parsedChoices())?.let { open -> clashResponses(open, userId) }
            }
        }
    if (clashes == null) call.respond(HttpStatusCode.NotFound) else call.respond(CombinePreviewResponse(clashes))
}

/** Runs [act], answering with the page, a refusal, or 404 when it found nothing. */
private suspend fun RoutingContext.write(act: RoutingContext.(String, Instant) -> CombineAnswer?) {
    val (userId, email) = call.principalIdAndEmail()
    val now = Clock.System.now()
    val (answer, page) =
        dbQuery {
            ensureUser(userId, email)
            val answer = act(userId, now) ?: CombineAnswer.NotFound
            answer to combinePage(userId, now)
        }
    when (answer) {
        CombineAnswer.NotFound -> call.respond(HttpStatusCode.NotFound)
        is CombineAnswer.Refused -> call.refuse(HttpStatusCode.Conflict, answer.refusal)
        CombineAnswer.Done -> call.respond(page)
    }
}
