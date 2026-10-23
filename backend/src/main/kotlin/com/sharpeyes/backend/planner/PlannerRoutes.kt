package com.sharpeyes.backend.planner

import com.sharpeyes.backend.db.PartyPlannerDraft
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock
import kotlin.time.Instant

// The Party Planner's saved settings. Mirrored by the frontend's types/planner.ts.

/** What was last saved, or nulls for an account that never has. */
@Serializable
data class SavedPlannerResponse(
    val draft: JsonElement?,
    val savedAt: String?,
)

@Serializable
data class SavePlannerRequest(
    val draft: JsonElement,
)

/** Far more than a full roster of characters and bosses needs, and a cap on what one row holds. */
internal const val MAX_DRAFT_CHARS = 200_000

fun Route.plannerRoutes() {
    get { getPlanner() }
    put { savePlanner() }
}

private suspend fun RoutingContext.getPlanner() {
    val (userId, email) = call.principalIdAndEmail()
    val saved =
        dbQuery {
            ensureUser(userId, email)
            savedPlannerFor(userId)
        }
    call.respond(saved)
}

private suspend fun RoutingContext.savePlanner() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePlannerRequest>()
    // Stored unread, so only its shape and size are checked. The page validates what it reads back.
    if (request.draft !is JsonObject || request.draft.toString().length > MAX_DRAFT_CHARS) {
        call.respond(HttpStatusCode.BadRequest, "draft must be an object under $MAX_DRAFT_CHARS characters")
        return
    }
    val saved =
        dbQuery {
            ensureUser(userId, email)
            savePlannerFor(userId, request.draft, Clock.System.now())
            savedPlannerFor(userId)
        }
    call.respond(saved)
}

internal fun savedPlannerFor(userId: String): SavedPlannerResponse {
    val row =
        PartyPlannerDraft
            .selectAll()
            .where { PartyPlannerDraft.userId eq userId }
            .singleOrNull()
            ?: return SavedPlannerResponse(draft = null, savedAt = null)
    return SavedPlannerResponse(
        draft = row[PartyPlannerDraft.draft],
        savedAt = row[PartyPlannerDraft.savedAt].toString(),
    )
}

/** Replaces the account's saved settings. One row per account, so a save is an upsert. */
internal fun savePlannerFor(
    userId: String,
    draft: JsonElement,
    now: Instant,
) {
    PartyPlannerDraft.upsert(PartyPlannerDraft.userId) {
        it[PartyPlannerDraft.userId] = userId
        it[PartyPlannerDraft.draft] = draft
        it[savedAt] = now
    }
}
