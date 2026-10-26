package com.sharpeyes.backend.groups

import com.sharpeyes.api.groups.InviteToGroupRequest
import com.sharpeyes.api.groups.SaveGroupRequest
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
import io.ktor.server.routing.put
import kotlin.time.Clock
import kotlin.uuid.Uuid

// /api/groups. Every write answers with the whole page, as /api/friends does. See Groups.kt.

fun Route.groupRoutes() {
    get { write { _, _ -> GroupAnswer.Done } }
    post {
        val body = call.receive<SaveGroupRequest>()
        write { userId, _ -> createGroup(userId, body.name, Clock.System.now()) }
    }
    put("/{id}") {
        val body = call.receive<SaveGroupRequest>()
        write("id") { userId, id -> renameGroup(userId, id!!, body.name) }
    }
    delete("/{id}/membership") { write("id") { userId, id -> leaveGroup(userId, id!!) } }
    post("/{id}/invites") {
        val body = call.receive<InviteToGroupRequest>()
        val personId = Uuid.parseOrNull(body.personId)
        write("id") { userId, id ->
            personId?.let { inviteToGroup(userId, id!!, it, Clock.System.now()) } ?: GroupAnswer.NotFound
        }
    }
    post("/invites/{id}/accept") { write("id") { userId, id -> acceptGroupInvite(userId, id!!, Clock.System.now()) } }
    // Declined by the invitee, or withdrawn by a member.
    delete("/invites/{id}") { write("id") { userId, id -> dropGroupInvite(userId, id!!) } }
}

/**
 * Runs [act] with the caller and the id in [param], answering with the page, 404 when [act] found
 * nothing (or the id did not parse), or the refusal.
 */
private suspend fun RoutingContext.write(
    param: String? = null,
    act: (String, Uuid?) -> GroupAnswer,
) {
    val (userId, email) = call.principalIdAndEmail()
    val id = param?.let { call.parameters[it]?.let(Uuid::parseOrNull) ?: return call.respond(HttpStatusCode.NotFound) }
    val (answer, page) =
        dbQuery {
            ensureUser(userId, email)
            val answer = act(userId, id)
            answer to (if (answer == GroupAnswer.Done) groupsFor(userId) else null)
        }
    when (answer) {
        GroupAnswer.Done -> call.respond(page!!)
        GroupAnswer.NotFound -> call.respond(HttpStatusCode.NotFound)
        is GroupAnswer.Refused -> call.refuse(HttpStatusCode.Conflict, answer.refusal)
    }
}
