package com.maplestorage.backend.items

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.plugins.span
import com.maplestorage.backend.services.DiscoverOutcome
import com.maplestorage.backend.services.ItemAuthoring
import com.maplestorage.backend.services.TemplateOutcome
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.post
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("ItemAuthoringRoutes")

// Nothing here writes. Both routes hand a capture to the vision service and hand its answer
// back, so a template can be cut and inspected before there is anywhere to keep it. Storing
// one, and counting it on future uploads, is the next step and is where the per-user catalog
// arrives.
fun Route.itemAuthoringRoutes(authoring: ItemAuthoring) {
    post("/untracked") { untrackedItems(authoring) }
    post("/template") { itemTemplate(authoring) }
}

private suspend fun RoutingContext.untrackedItems(authoring: ItemAuthoring) {
    val (userId, _) = call.principalIdAndEmail()
    val request = call.receive<UntrackedItemsRequest>()

    val outcome =
        call.span("discover") {
            authoring.discoverUntracked(decode(request.imageBase64), request.mediaType)
        }

    when (outcome) {
        is DiscoverOutcome.Found -> {
            log.info("discover for {}: {} known, {} offerable", userId, outcome.knownCount, outcome.slots.size)
            call.respond(UntrackedItemsResponse(slots = outcome.slots, knownCount = outcome.knownCount))
        }
        // The vision service's own wording, which tells the user what to do about the
        // capture. Flattening it to a generic failure would send them to fix the wrong thing.
        is DiscoverOutcome.Failed -> call.respond(HttpStatusCode.UnprocessableEntity, outcome.reason)
    }
}

private suspend fun RoutingContext.itemTemplate(authoring: ItemAuthoring) {
    val (userId, _) = call.principalIdAndEmail()
    val request = call.receive<ItemTemplateRequest>()

    val outcome =
        call.span("template") {
            authoring.cutTemplate(decode(request.imageBase64), request.mediaType, request.row, request.col)
        }

    when (outcome) {
        is TemplateOutcome.Cut -> {
            log.info("cut r{}c{} for {}, coverage {}", request.row, request.col, userId, outcome.coverage)
            call.respond(ItemTemplateResponse(templatePng = outcome.templatePng, coverage = outcome.coverage))
        }
        // 409 all the way out. The capture was fine and re-taking it will not help, so this
        // must not reach the UI looking like the 422 next to it.
        is TemplateOutcome.AlreadyTracked -> call.respond(HttpStatusCode.Conflict, outcome.reason)
        is TemplateOutcome.Failed -> call.respond(HttpStatusCode.UnprocessableEntity, outcome.reason)
    }
}

private fun decode(base64: String): ByteArray =
    java.util.Base64
        .getDecoder()
        .decode(base64)
