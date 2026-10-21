package com.sharpeyes.backend.friends

import com.sharpeyes.backend.plugins.Refusal
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
import kotlin.uuid.Uuid

@Serializable
data class SendFriendRequest(
    val username: String,
)

/** Somebody else's account, as the Social page shows it. */
@Serializable
data class FriendView(
    /** The request's id on a request, the person's id on a friend. */
    val id: String,
    val username: String?,
    val name: String?,
    val spriteImgUrl: String?,
)

@Serializable
data class SocialResponse(
    /** Yours, so you can tell a friend what to type. Null until you sign in with Discord. */
    val username: String?,
    val friends: List<FriendView>,
    val outgoing: List<FriendView>,
)

/** What sending a request did. */
internal sealed interface SendOutcome {
    data object Unknown : SendOutcome

    data object Yourself : SendOutcome

    data object AlreadyFriends : SendOutcome

    data object Sent : SendOutcome

    /** They had already asked you, so asking back is accepting. */
    data object Accepted : SendOutcome
}

fun Route.friendRoutes() {
    get { respondSocial() }
    post("/requests") { sendRoute() }
    post("/requests/{id}/accept") { acceptRoute() }
    delete("/requests/{id}") { dropRoute() }
    delete("/{personId}") { removeRoute() }
}

/** GET /api/friends. */
private suspend fun RoutingContext.respondSocial() {
    val (userId, email) = call.principalIdAndEmail()
    call.respond(
        dbQuery {
            ensureUser(userId, email)
            socialFor(userId)
        },
    )
}

/** POST /api/friends/requests. Answers with the whole page, a request back being an acceptance. */
private suspend fun RoutingContext.sendRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val body = call.receive<SendFriendRequest>()
    val (outcome, social) =
        dbQuery {
            ensureUser(userId, email)
            sendFriendRequest(userId, body.username, Clock.System.now()) to socialFor(userId)
        }
    when (outcome) {
        SendOutcome.Unknown ->
            call.refuse(HttpStatusCode.NotFound, Refusal("No one here has that Discord name. Check the spelling."))
        SendOutcome.Yourself ->
            call.refuse(HttpStatusCode.Conflict, Refusal("That is your own Discord name. Enter a friend's."))
        SendOutcome.AlreadyFriends -> call.refuse(HttpStatusCode.Conflict, Refusal("You're already friends."))
        SendOutcome.Sent, SendOutcome.Accepted -> call.respond(social)
    }
}

private suspend fun RoutingContext.acceptRoute() =
    answer { userId, id -> acceptFriendRequest(userId, id, Clock.System.now()) }

private suspend fun RoutingContext.dropRoute() = answer { userId, id -> dropFriendRequest(userId, id) }

private suspend fun RoutingContext.removeRoute() = answer("personId") { userId, id -> removeFriend(userId, id) }

/** Runs [act] on the id in the path, answering with the page, or 404 when [act] found nothing. */
private suspend fun RoutingContext.answer(
    param: String = "id",
    act: (String, Uuid) -> Boolean,
) {
    val (userId, email) = call.principalIdAndEmail()
    val id = call.parameters[param]?.let(Uuid::parseOrNull)
    val social =
        id?.let {
            dbQuery {
                ensureUser(userId, email)
                if (act(userId, it)) socialFor(userId) else null
            }
        }
    if (social == null) call.respond(HttpStatusCode.NotFound) else call.respond(social)
}
