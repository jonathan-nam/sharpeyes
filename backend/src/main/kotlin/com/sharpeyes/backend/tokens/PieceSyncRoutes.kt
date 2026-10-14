package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock

// Mirrored by the frontend's types/piece-sync.ts field-for-field.

@Serializable
data class PieceSyncResponse(
    val enabled: Boolean,
    val gaps: List<PieceSyncGapResponse>,
)

@Serializable
data class SavePieceSyncRequest(
    val enabled: Boolean,
)

fun Route.pieceSyncRoutes() {
    get { getPieceSync() }
    put { savePieceSync() }
}

private suspend fun RoutingContext.getPieceSync() {
    val (userId, email) = call.principalIdAndEmail()
    val response =
        dbQuery {
            ensureUser(userId, email)
            pieceSyncFor(userId)
        }
    call.respond(response)
}

/**
 * Turns the sync on or off. Neither direction touches a count.
 *
 * On applies from the next clear: one ticked before may or may not already be in a typed count,
 * so it is listed as a gap rather than added. Off stops new credits AND takebacks, so un-ticking a
 * clear while it is off leaves the inventory as it is.
 */
private suspend fun RoutingContext.savePieceSync() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePieceSyncRequest>()
    val response =
        dbQuery {
            ensureUser(userId, email)
            setPieceSync(userId, request.enabled)
            pieceSyncFor(userId)
        }
    call.respond(response)
}

/** The flag and nothing else: turning the sync on or off never moves a count. */
internal fun setPieceSync(
    userId: String,
    enabled: Boolean,
) {
    Users.update({ Users.id eq userId }) { it[syncPiecesFromClears] = enabled }
}

internal fun pieceSyncFor(userId: String): PieceSyncResponse =
    PieceSyncResponse(
        enabled = syncEnabled(userId),
        gaps = pieceSyncGapsFor(userId, Clock.System.now()),
    )
