package com.sharpeyes.backend.notifications

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** Every route answers with the whole list, so the bell redraws from what is now true. */
fun Route.notificationRoutes() {
    get { answer { } }
    // Opening the bell is reading them.
    post("/read") { answer { markAllRead(it, Clock.System.now()) } }
    delete("/{id}") {
        val id = call.parameters["id"]?.let(Uuid::parseOrNull)
        if (id == null) call.respond(HttpStatusCode.NotFound) else answer { dismiss(it, id) }
    }
}

private suspend fun RoutingContext.answer(act: (String) -> Unit) {
    val (userId, email) = call.principalIdAndEmail()
    call.respond(
        dbQuery {
            ensureUser(userId, email)
            act(userId)
            notificationsFor(userId)
        },
    )
}
