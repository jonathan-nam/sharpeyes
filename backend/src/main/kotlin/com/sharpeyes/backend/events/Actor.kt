package com.sharpeyes.backend.events

import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingNode
import io.ktor.util.AttributeKey
import kotlinx.coroutines.asContextElement
import kotlinx.coroutines.withContext

// Who made a change, so a live event can say so and the other side's screen can show their face on
// what moved. Remembered for the length of the request, as a coroutine context element: dbQuery
// hops to the IO dispatcher, and the element follows it there, so publish() reads it from inside
// the writer's transaction without every writer passing it down.

internal val ACTOR = ThreadLocal<String?>()

/** Remembers the signed-in caller for every request under this route. */
fun Route.rememberActor() {
    // The pipeline is the node's; Route is only the builder face of it in Ktor 3.
    (this as RoutingNode).intercept(ApplicationCallPipeline.Call) {
        val user = call.principal<JWTPrincipal>()?.payload?.subject
        withContext(ACTOR.asContextElement(user)) { proceed() }
    }
}

private val EVENT_PERSON = AttributeKey<String>("eventPerson")

/** The Settlement card a write is about, for a route whose path does not name it. See ledgerRoute. */
fun ApplicationCall.eventPerson(personId: String?) {
    if (personId != null) attributes.put(EVENT_PERSON, personId)
}

internal fun ApplicationCall.eventPersonOrNull(): String? = attributes.getOrNull(EVENT_PERSON)
