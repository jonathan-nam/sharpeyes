package com.sharpeyes.backend.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.head
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.util.concurrent.atomic.AtomicReference
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * How long the probe gets before this reports the database unreachable.
 *
 * Bounded because Hikari's connectionTimeout is 30s by default and Database.kt does not set it, so
 * with Postgres actually down `transaction {}` blocks for half a minute and the endpoint answers
 * nothing at all. Measured against a stopped Postgres: without this, curl gave up at 20s having
 * received no response. A monitor reads a timeout as down either way, but a hang pins a thread and
 * logs no reason, and neither is what a health check is for.
 */
private val PROBE_TIMEOUT = 2.seconds

/**
 * Answers "could the app reach its database", for something watching from outside.
 *
 * Separate from /health on purpose. That one gates rolling deploys and deliberately touches no
 * table, so a slow query cannot stall one. The cost is that it answers "ok" with Postgres dead and
 * the site unusable, so an uptime check pointed at it stays green through the outage it was added
 * to catch. This is the endpoint to point a monitor at.
 *
 * Extracted from the route so both branches are testable. The 503 is the one that matters and it is
 * the one you cannot exercise by having a working database.
 */
suspend fun ApplicationCall.dbReachable(
    timeout: Duration = PROBE_TIMEOUT,
    probe: () -> Boolean,
): Boolean {
    // On a thread we are willing to abandon, joined with a deadline.
    //
    // withTimeout does NOT work here and the obvious version of this shipped broken. Cancellation in
    // coroutines is cooperative, and a blocking JDBC call offers no suspension point to cancel at,
    // so the timeout only fires once the call it was meant to bound has already returned. The test
    // that blocks for 30s catches it.
    //
    // Daemon so a probe still stuck on a dead database cannot hold JVM shutdown open. It finishes
    // on its own once Hikari gives up, and nobody is listening by then.
    val reason = AtomicReference<String?>(null)
    val result = AtomicReference<Boolean?>(null)
    val worker =
        Thread {
            // Broad on purpose. The question is whether the database was reachable, and the ways it
            // is not are not one exception type: a refused socket, an exhausted Hikari pool and a
            // killed backend read differently and all mean the same thing here.
            @Suppress("TooGenericExceptionCaught")
            val answer =
                try {
                    probe()
                } catch (e: Exception) {
                    reason.set("db unreachable: ${e.message}")
                    false
                }
            result.set(answer)
        }
    worker.isDaemon = true
    worker.name = "db-health-probe"
    worker.start()

    withContext(Dispatchers.IO) { worker.join(timeout.inWholeMilliseconds) }

    val reachable = result.get() ?: false
    if (!reachable) {
        failing(reason.get() ?: "db probe did not answer within $timeout")
    }

    return reachable
}

/**
 * The GET body. Split from [dbReachable] so HEAD can ask the same question and answer without one.
 */
suspend fun ApplicationCall.respondDbHealth(
    timeout: Duration = PROBE_TIMEOUT,
    probe: () -> Boolean,
) {
    if (dbReachable(timeout, probe)) {
        respond(mapOf("status" to "ok"))
    } else {
        respond(HttpStatusCode.ServiceUnavailable, mapOf("status" to "db unreachable"))
    }
}

/**
 * Both health endpoints, as one Route extension like every other route group here.
 *
 * Grouped mostly to keep configureRouting under detekt's LongMethod limit, which adding /health/db
 * inline pushed it past.
 */
fun Route.healthRoutes() {
    // Unauthenticated on purpose: deploy.sh polls it through nginx to decide when a restarted
    // replica may take traffic. It answers only once Flyway has migrated, which is the signal a
    // rolling deploy waits on, and it touches no table, so a slow query cannot stall one.
    get("/health") {
        call.respond(mapOf("status" to "ok"))
    }

    get("/health/db") {
        call.respondDbHealth { dbProbe() }
    }

    // HEAD, because uptime monitors default to it: it is cheaper and they only want the status.
    // Without these, such a monitor gets 405 on every check and reports the site permanently down,
    // which is worse than no monitor because you learn to ignore it. Ktor routes HEAD separately
    // from GET and answers 405 otherwise.
    //
    // Status only. A HEAD response must not carry a body.
    head("/health") {
        call.respond(HttpStatusCode.OK)
    }

    head("/health/db") {
        val status =
            if (call.dbReachable { dbProbe() }) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable
        call.respond(status)
    }
}

/**
 * The cheapest question that still proves the database answered. Shared by GET and HEAD so the two
 * cannot drift into checking different things.
 *
 * Plain `transaction` rather than dbQuery: dbReachable already runs this on a daemon thread of its
 * own so it can be abandoned on timeout, which is off the event loop by a different route.
 */
private fun dbProbe(): Boolean = transaction { exec("SELECT 1") { rows -> rows.next() } } == true
