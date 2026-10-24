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
    /** Their current Discord avatar. See imagesOf. */
    val image: String? = null,
)

/** Who a typed Discord username is, for the preview beside the box. */
@Serializable
data class DiscordLookupResponse(
    val username: String,
    val image: String?,
    /** Their main character, which is how the bell will name them. */
    val name: String?,
    val spriteImgUrl: String?,
    /** The name is your own. */
    val you: Boolean,
)

/** Null when nobody here has the name. */
@Serializable
data class DiscordLookupAnswer(
    val found: DiscordLookupResponse?,
)

@Serializable
data class SocialResponse(
    /** Yours, so you can tell a friend what to type. Null until you sign in with Discord. */
    val username: String?,
    val friends: List<FriendView>,
    val outgoing: List<FriendView>,
    /** Requests to you, so one cleared from the bell can still be answered. */
    val incoming: List<FriendView>,
)

/** What sending a request did. */
internal sealed interface SendOutcome {
    data object Unknown : SendOutcome

    data object Yourself : SendOutcome

    data object AlreadyFriends : SendOutcome

    data object Sent : SendOutcome

    /** They had already asked you, so asking back is accepting. */
    data object Accepted : SendOutcome

    /** The person named is not one of yours. */
    data object NoSuchPerson : SendOutcome

    /** The person named already has an account. */
    data object PersonLinked : SendOutcome
}

/** The refusal for each outcome that sends nothing, null for the two that did. */
internal fun SendOutcome.refusal(): Pair<HttpStatusCode, Refusal>? =
    when (this) {
        SendOutcome.Unknown ->
            HttpStatusCode.NotFound to Refusal("No one here has that Discord name. Check the spelling.")
        SendOutcome.Yourself ->
            HttpStatusCode.Conflict to Refusal("That is your own Discord name. Enter a friend's.")
        SendOutcome.AlreadyFriends -> HttpStatusCode.Conflict to Refusal("You're already friends.")
        SendOutcome.NoSuchPerson -> HttpStatusCode.NotFound to Refusal("That person is gone. Reload.")
        SendOutcome.PersonLinked -> HttpStatusCode.Conflict to Refusal("They're already linked.")
        SendOutcome.Sent, SendOutcome.Accepted -> null
    }

fun Route.friendRoutes() {
    get { respondSocial() }
    get("/lookup") { lookupRoute() }
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

/**
 * GET /api/friends/lookup?username=. Nobody by that name is an answer, not an error: it is asked
 * as the name is typed, and a 404 per keystroke would be logged as a failure each time.
 */
private suspend fun RoutingContext.lookupRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val username = call.request.queryParameters["username"].orEmpty()
    val found =
        dbQuery {
            ensureUser(userId, email)
            lookupFor(userId, username)
        }
    call.respond(DiscordLookupAnswer(found))
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
    val refusal = outcome.refusal()
    if (refusal != null) call.refuse(refusal.first, refusal.second) else call.respond(social)
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
