package com.sharpeyes.backend.screenshots

import com.sharpeyes.backend.characters.findOwnedCharacter
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.span
import com.sharpeyes.backend.services.ScreenshotParser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.post
import kotlin.uuid.Uuid

fun Route.screenshotRoutes(screenshotParser: ScreenshotParser) {
    post { uploadScreenshot(screenshotParser) }
    post("/{id}/resolve") { resolveScreenshotRoute() }
    post("/{id}/ignore") { ignoreScreenshotRoute() }
}

private suspend fun RoutingContext.uploadScreenshot(screenshotParser: ScreenshotParser) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<UploadScreenshotRequest>()

    val pinnedCharacterId = request.characterId?.let { Uuid.parseOrNull(it) }
    if (request.characterId != null && pinnedCharacterId == null) {
        call.respond(HttpStatusCode.BadRequest, "malformed characterId")
        return
    }
    // Ownership check before parsing a request that would
    // 404 anyway. Also stops a screenshot from ever getting attributed
    // under another user's guessed/stolen character id.
    if (pinnedCharacterId != null) {
        val owned = dbQuery { findOwnedCharacter(pinnedCharacterId, userId) }
        if (owned == null) {
            call.respond(HttpStatusCode.NotFound)
            return
        }
    }

    // The upload's whole cost is here: base64 decode, the OpenCV parse over loopback,
    // then the DB writes. Timing it as one span tells you whether a slow upload is the
    // parse or everything else.
    val result =
        call.span("ingest") {
            ingestScreenshot(
                userId = userId,
                email = email,
                request = request,
                pinnedCharacterId = pinnedCharacterId,
                screenshotParser = screenshotParser,
            )
        }
    call.respond(result)
}

private suspend fun RoutingContext.resolveScreenshotRoute() {
    val (userId, _) = call.principalIdAndEmail()
    val screenshotId = call.parseUuidParam("id") ?: return
    val request = call.receive<ResolveScreenshotRequest>()
    val newCharacterId =
        Uuid.parseOrNull(request.characterId) ?: run {
            call.respond(HttpStatusCode.BadRequest, "malformed characterId")
            return
        }

    val resolved = resolveScreenshot(userId, screenshotId, newCharacterId)
    if (resolved) {
        call.respond(HttpStatusCode.NoContent)
    } else {
        call.respond(HttpStatusCode.NotFound)
    }
}

private suspend fun RoutingContext.ignoreScreenshotRoute() {
    val (userId, _) = call.principalIdAndEmail()
    val screenshotId = call.parseUuidParam("id") ?: return

    if (ignoreScreenshot(userId, screenshotId)) {
        call.respond(HttpStatusCode.NoContent)
    } else {
        call.respond(HttpStatusCode.NotFound)
    }
}
