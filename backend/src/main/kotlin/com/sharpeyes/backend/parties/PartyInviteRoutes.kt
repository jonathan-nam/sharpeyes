package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.refuse
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.post
import kotlin.time.Clock

// /api/party-invites/{id}: the invitee's answer, or the owner withdrawing it. See PartyInvites.kt.

fun Route.partyInviteRoutes() {
    post("/{id}/accept") { acceptRoute() }
    // Declined by the invitee, or withdrawn by the party's owner.
    delete("/{id}") { dropRoute() }
}

private suspend fun RoutingContext.acceptRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val inviteId = call.parseUuidParam("id") ?: return
    val answer =
        dbQuery {
            ensureUser(userId, email)
            acceptInvite(userId, inviteId, Clock.System.now())
        }
    when (answer) {
        InviteAnswer.NotFound -> call.respond(HttpStatusCode.NotFound)
        is InviteAnswer.Refused -> call.refuse(HttpStatusCode.Conflict, answer.refusal)
        is InviteAnswer.Joined -> call.respond(JoinedPartyResponse(answer.partyId.toString()))
    }
}

private suspend fun RoutingContext.dropRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val inviteId = call.parseUuidParam("id") ?: return
    val dropped =
        dbQuery {
            ensureUser(userId, email)
            dropInviteAs(userId, inviteId, Clock.System.now())
        }
    call.respond(if (dropped) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
}
