package com.sharpeyes.backend.parties

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
import kotlinx.serialization.Serializable
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// /api/party-combines: Social's Combine Parties. Every write answers with the whole list. See CombineParties.kt.

/** One of the two parties, as the page draws it. */
@Serializable
data class CombineSideResponse(
    val partyId: String,
    val leader: String,
    val difficulty: String?,
    val members: List<String>,
)

@Serializable
data class CombineProposalResponse(
    val id: String,
    val keepPartyId: String,
    /** You asked, so it waits on them. */
    val yours: Boolean,
)

@Serializable
data class CombinePairResponse(
    val bossKey: String,
    val boss: String,
    /** Your name for the other owner, from People. */
    val friend: String,
    val friendImage: String?,
    val mine: CombineSideResponse,
    val theirs: CombineSideResponse,
    /** Which of the two can be kept: the one already seating the other owner's character. */
    val keepable: List<String>,
    /** The first date the kept party would be shared from, combined now. */
    val sharedFrom: String,
    val proposal: CombineProposalResponse?,
)

@Serializable
data class CombinePageResponse(
    val pairs: List<CombinePairResponse>,
)

@Serializable
data class ProposeCombineRequest(
    val keepPartyId: String,
    val retirePartyId: String,
)

fun Route.combineRoutes() {
    get { respondPage() }
    post { proposeRoute() }
    post("/{id}/accept") { write { userId, now -> acceptCombine(userId, idParam() ?: return@write null, now) } }
    // Declined by the other owner, or withdrawn by the one who asked.
    delete("/{id}") {
        write { userId, _ ->
            val id = idParam() ?: return@write null
            if (dropCombine(userId, id)) CombineAnswer.Done else CombineAnswer.NotFound
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

private suspend fun RoutingContext.proposeRoute() {
    val body = call.receive<ProposeCombineRequest>()
    val keep = Uuid.parseOrNull(body.keepPartyId)
    val retire = Uuid.parseOrNull(body.retirePartyId)
    write { userId, now -> if (keep == null || retire == null) null else proposeCombine(userId, keep, retire, now) }
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
