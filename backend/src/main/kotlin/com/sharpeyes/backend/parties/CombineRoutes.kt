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

/** A seat as the page draws it: the character and its sprite proxy path. */
@Serializable
data class SeatFace(
    val name: String,
    val sprite: String?,
)

/** One of the two parties of a conflict. */
@Serializable
data class CombineSideResponse(
    val partyId: String,
    val leader: String,
    val difficulty: String?,
    /** Standing seats, the owner's own included. */
    val members: List<SeatFace>,
)

/** A pair the sender has to choose for. */
@Serializable
data class CombinePairResponse(
    val bossKey: String,
    val boss: String,
    val mine: CombineSideResponse,
    val theirs: CombineSideResponse,
    /** Which of the two can be kept: the one already seating the other owner's character. */
    val keepable: List<String>,
    /** The first date the kept party would be shared from, combined now. */
    val sharedFrom: String,
)

/** Combining with one friend, from the sender's side. */
@Serializable
data class CombineWithResponse(
    /** Your person row for them. */
    val personId: String,
    val friend: String,
    val friendImage: String?,
    val matched: Int,
    /** Pairs that settle themselves, by whose copy they keep. */
    val keepsYours: Int,
    val keepsTheirs: Int,
    val conflicts: List<CombinePairResponse>,
    /** Your request to them, while it waits. */
    val sentRequestId: String?,
)

/** A request waiting on you, as one line. */
@Serializable
data class IncomingCombineResponse(
    val id: String,
    val friend: String,
    val friendImage: String?,
    val total: Int,
    val keepsYours: Int,
    val keepsTheirs: Int,
)

@Serializable
data class CombinePageResponse(
    val friends: List<CombineWithResponse>,
    val incoming: List<IncomingCombineResponse>,
)

/** A conflict's answer. A null keepPartyId leaves the two parties separate. */
@Serializable
data class CombineChoiceRequest(
    val mine: String,
    val theirs: String,
    val keepPartyId: String?,
)

@Serializable
data class SendCombineRequest(
    val personId: String,
    val choices: List<CombineChoiceRequest> = emptyList(),
)

fun Route.combineRoutes() {
    get { respondPage() }
    post { sendRoute() }
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

private suspend fun RoutingContext.sendRoute() {
    val body = call.receive<SendCombineRequest>()
    val person = Uuid.parseOrNull(body.personId)
    val choices =
        body.choices.mapNotNull { choice ->
            val mine = Uuid.parseOrNull(choice.mine)
            val theirs = Uuid.parseOrNull(choice.theirs)
            if (mine == null ||
                theirs == null
            ) {
                null
            } else {
                CombineChoice(mine, theirs, choice.keepPartyId?.let(Uuid::parseOrNull))
            }
        }
    write { userId, now -> person?.let { sendCombine(userId, it, choices, now) } }
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
