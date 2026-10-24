package com.sharpeyes.backend.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("ClientError")

private val json = Json { ignoreUnknownKeys = true }

// What the browser is allowed to say went wrong. The endpoint is unauthenticated, so the log line
// is built only from values we recognise: an unrecognised kind is dropped rather than echoed.
//
// `http` the request got a response and it was not ok. Timing.kt has the server's side of it.
// `network` no response at all. This is the one the server cannot see for itself: a CORS
//           rejection, a dropped connection, a backend that is down.
// `parity`  the browser's money figures and the server's disagreed (lib/money-shadow.ts). Only
//           where: the first differing JSON path and how many differ, never a value.
private val ALLOWED_KINDS = setOf("http", "network", "parity")

/** A JSON path like `view.settlement.2.mesos`: names, indices and dots only, and short. */
private val FIELD_PATH = Regex("^[A-Za-z0-9_.]{1,160}$")

private const val MAX_COUNT = 1_000_000

private const val MIN_STATUS = 100
private const val MAX_STATUS = 599

private val UUID_SEGMENT = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
private val NUMERIC_SEGMENT = Regex("^\\d+$")

/**
 * Drop the ids out of a reported path, keeping its shape.
 *
 * The client strips these too (see report-error.ts), which is not a reason to trust that it did:
 * anyone can post here, and "anonymous by construction" has to be a property of the endpoint
 * rather than a promise about its callers. `/api/parties/:id/loot` is also the more useful thing
 * to count, since the question is which endpoint is failing and not which row.
 */
internal fun endpointShape(path: String): String =
    path
        .substringBefore('?')
        .split('/')
        .joinToString("/") { if (UUID_SEGMENT.matches(it) || NUMERIC_SEGMENT.matches(it)) ":id" else it }

/**
 * Anonymous by construction, exactly as the vitals beacon is: no user id, no IP, no request body.
 * A path is an API route ("/api/parties"), never an id-bearing one the caller composed.
 */
@Serializable
private data class ClientErrorReport(
    val kind: String,
    val path: String? = null,
    val status: Int? = null,
    val route: String? = null,
    val nav: String? = null,
    val conn: String? = null,
    val device: String? = null,
    val tz: String? = null,
    val lang: String? = null,
    val v: String? = null,
    /** A parity report's first differing path. */
    val field: String? = null,
    /** A parity report's number of differing paths. */
    val count: Int? = null,
)

fun Route.clientErrorRoutes() {
    // Unauthenticated and fire-and-forget, for the same reasons as /api/vitals: a sendBeacon
    // target sent as text/plain so it needs no preflight. A failure report that itself needed a
    // working authenticated request would be silent in precisely the cases it exists for.
    post {
        val report = runCatching { json.decodeFromString<ClientErrorReport>(call.receiveText()) }.getOrNull()
        if (report != null && report.kind in ALLOWED_KINDS) {
            val line =
                buildString {
                    append("client ").append(report.kind)
                    field("path", report.path?.let { endpointShape(it) })
                    field("status", report.status?.takeIf { it in MIN_STATUS..MAX_STATUS }?.toString())
                    field("route", report.route)
                    field("nav", report.nav)
                    field("conn", report.conn)
                    field("device", report.device)
                    field("tz", report.tz)
                    field("lang", report.lang)
                    field("v", report.v)
                    field("field", report.field?.takeIf { FIELD_PATH.matches(it) })
                    field("count", report.count?.takeIf { it in 1..MAX_COUNT }?.toString())
                }
            log.warn(line)
        }
        call.respond(HttpStatusCode.NoContent)
    }
}
