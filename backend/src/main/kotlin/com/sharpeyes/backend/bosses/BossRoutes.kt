package com.sharpeyes.backend.bosses

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.datetime.LocalDate
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

fun Route.bossRoutes() {
    get { listBosses() }
    get("/clears") { getCurrentBossClears() }
    put("/clears") { setBossClearRoute() }
    put("/routine") { setBossRoutineRoute() }
    get("/drops") { getDropTables() }
}

// Every boss's drop table, from catalog/drops.yaml. Served rather than shipped in the frontend
// for the reason the boss catalog is: adding a drop stays a one-file change.
internal suspend fun RoutingContext.getDropTables() {
    val (userId, email) = call.principalIdAndEmail()
    val tables =
        dbQuery {
            ensureUser(userId, email)
            dropTables()
        }
    call.respond(tables)
}

// The catalog itself, in progression order. Served rather than shipped in the frontend so the
// matrix's columns come from catalog/bosses.yaml like everything else does, and adding a boss
// stays a one-file change.
internal suspend fun RoutingContext.listBosses() {
    val (userId, email) = call.principalIdAndEmail()
    val bosses =
        dbQuery {
            ensureUser(userId, email)
            bossCatalog()
        }
    call.respond(bosses)
}

/**
 * The matrix's data: the current period by default, or one past week with `?week=YYYY-MM-DD`.
 *
 * A malformed or off-boundary week is refused rather than served as an empty matrix. An empty
 * matrix is indistinguishable from a real week nobody captured, so answering one for a Tuesday
 * would be a confident wrong answer instead of a 400.
 */
internal suspend fun RoutingContext.getCurrentBossClears() {
    val (userId, email) = call.principalIdAndEmail()
    val now = Clock.System.now()

    val week =
        parseWeekParam(call.request.queryParameters["week"]).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }

    val view =
        dbQuery {
            ensureUser(userId, email)
            clearsView(userId, week, now)
        }
    call.respond(view)
}

/**
 * Ticks one cell of the matrix cleared, or un-ticks it.
 *
 * The current period only. A past week is read-only for the reason it is on Party View: the clears
 * it carries are weekly rows alone, so a tick there would have no unambiguous period to land in.
 *
 * Answers with the refreshed view rather than a bare 204. The period a tick lands in is decided
 * here, from the boss's cadence, so reading it back is how the matrix ends up showing what was
 * actually written instead of what the client assumed.
 */
internal suspend fun RoutingContext.setBossClearRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SetBossClearRequest>()
    val characterId =
        Uuid.parseOrNull(request.characterId)
            ?: return call.respond(HttpStatusCode.BadRequest, "malformed characterId")
    val now = Clock.System.now()

    val view =
        dbQuery {
            ensureUser(userId, email)
            if (!setBossClearByHand(userId, characterId, request.bossKey, request.cleared, now)) {
                null
            } else {
                clearsView(userId, null, now)
            }
        }
    if (view == null) call.respond(HttpStatusCode.NotFound) else call.respond(view)
}

/**
 * Replaces which bosses a character runs, in one save.
 *
 * The whole set at once, because the editor is a checklist of every boss and what it has to say is
 * "this is the routine now". Answers with the refreshed matrix so the page that sent it does not
 * have to work out what changed.
 */
internal suspend fun RoutingContext.setBossRoutineRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SetBossRoutineRequest>()
    val characterId =
        Uuid.parseOrNull(request.characterId)
            ?: return call.respond(HttpStatusCode.BadRequest, "malformed characterId")
    val now = Clock.System.now()

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val refusal = setBossRoutine(userId, characterId, request.skippedBossKeys, now)
            refusal ?: clearsView(userId, null, now)
        }
    when (outcome) {
        is RoutineRefusal.Unknown -> call.respond(HttpStatusCode.NotFound)
        // Shown to the user as-is, so it is a sentence rather than an error code. The editor locks
        // these bosses, so meeting this means the two got out of step.
        is RoutineRefusal.HasParty ->
            call.respond(
                HttpStatusCode.Conflict,
                "${outcome.bossNames.joinToString(", ")}: remove the party first.",
            )
        else -> call.respond(outcome as BossClearsViewResponse)
    }
}

/** The matrix as of [now], for the current period when [week] is null. Call inside a transaction. */
private fun clearsView(
    userId: String,
    week: LocalDate?,
    now: Instant,
): BossClearsViewResponse {
    val currentWeek = periodStartFor(WEEKLY_CADENCE, now)
    // Shown week for navigation purposes: the current view is the current week, it just draws the
    // other two cadences as well.
    val shown = week ?: currentWeek
    val navigation = weekNavigation(shown, currentWeek, earliestWeekStartFor(userId))
    val clears = if (week == null) currentBossClearsFor(userId, now) else weeklyClearsFor(userId, week)
    return BossClearsViewResponse(
        clearsByCharacter = clears,
        // A past week gets the routine as it stood AT THE END OF IT, not as it stands now: a boss
        // the character only started skipping since was one they ran that week. Withheld entirely
        // before, which left the week with a count and no target to measure it against.
        skipsByCharacter = bossSkipsFor(userId, asOf = week?.let { periodEndInstant(WEEKLY_CADENCE, it) }),
        weekStart = week?.toString(),
        previousWeekStart = navigation.previous?.toString(),
        nextWeekStart = navigation.next?.toString(),
        currentWeekStart = currentWeek.toString(),
        nextResets = RESET_CADENCES.associateWith { nextResetAfter(it, now).toString() },
        now = now.toString(),
    )
}
