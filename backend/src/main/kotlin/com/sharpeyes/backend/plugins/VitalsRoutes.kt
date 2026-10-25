package com.sharpeyes.backend.plugins

import com.sharpeyes.api.system.VitalReport
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("Rum")

private val json = Json { ignoreUnknownKeys = true }

// Web-vitals names we accept, plus our own app-level mark. The endpoint is
// unauthenticated, so the log line must be built only from values we recognise: an
// unrecognised name is dropped rather than echoed into the log.
// "data-ready" is ours, sent by lib/rum.ts, and carries a route like the rest so one name covers
// every page. Held in step with the frontend by frontend/lib/rum-names.test.ts, because the name it
// replaced sat here thresholded for months with nothing sending it, and dropping is silent.
private val ALLOWED_NAMES =
    setOf("LCP", "FCP", "CLS", "INP", "TTFB", "FID", "data-ready", "auth-ready", "money-browser", "money-fetch")

// Google's web-vitals "poor" cutoffs (ms, except CLS which is unitless), plus our own
// mark. A real user over these gets a louder level, mirroring Timing.kt's SLOW: a slow
// field load becomes a grep, not a hunch.
private const val LCP_POOR_MS = 4000.0
private const val FCP_POOR_MS = 3000.0
private const val INP_POOR_MS = 500.0
private const val TTFB_POOR_MS = 1800.0
private const val CLS_POOR = 0.25
private const val FID_POOR_MS = 300.0

// LCP's good/needs-improvement boundary, not its 4000ms POOR bar: the 2.8s load this mark was
// added for would have cleared 4000 and told us the page was fine.
private const val DATA_READY_POOR_MS = 2500.0

// Two round trips to the auth service, and nothing on the page can be asked for until they are
// done. A second of that is not a slow network, it is the auth service in trouble.
private const val AUTH_READY_POOR_MS = 1000.0

// The Drop Log's money, from lib/money-shadow.ts. `money-browser` is the composition run on the main
// thread: two 50ms long-task budgets is a stall a click can land in. `money-fetch` is the server's
// figures round trip, which a page reading the server (Phase 5) would wait on instead.
private const val MONEY_BROWSER_POOR_MS = 100.0
private const val MONEY_FETCH_POOR_MS = 1000.0

private val POOR =
    mapOf(
        "LCP" to LCP_POOR_MS,
        "FCP" to FCP_POOR_MS,
        "INP" to INP_POOR_MS,
        "TTFB" to TTFB_POOR_MS,
        "CLS" to CLS_POOR,
        "FID" to FID_POOR_MS,
        "data-ready" to DATA_READY_POOR_MS,
        "auth-ready" to AUTH_READY_POOR_MS,
        "money-browser" to MONEY_BROWSER_POOR_MS,
        "money-fetch" to MONEY_FETCH_POOR_MS,
    )

// Below this, keep decimals (CLS is a small fraction); at or above, a whole millisecond.
private const val DECIMAL_BELOW = 10.0

fun Route.vitalsRoutes() {
    // Unauthenticated and fire-and-forget: a navigator.sendBeacon target, sent as
    // text/plain (a CORS-safelisted type, so no preflight to be dropped as the page
    // unloads). It never touches the DB and never errors on bad input, a malformed
    // beacon is dropped, not turned into noise or a 4xx the client never reads.
    post {
        val report = runCatching { json.decodeFromString<VitalReport>(call.receiveText()) }.getOrNull()
        if (report != null && report.isAcceptable()) {
            val line =
                buildString {
                    append("rum ").append(report.name).append('=').append(fmt(report.value))
                    field("rating", report.rating)
                    field("route", report.route)
                    field("nav", report.nav)
                    field("conn", report.conn)
                    field("device", report.device)
                    field("tz", report.tz)
                    field("lang", report.lang)
                    field("v", report.v)
                }
            val poor = POOR[report.name]
            if (poor != null && report.value > poor) log.warn("SLOW $line") else log.info(line)
        }
        call.respond(HttpStatusCode.NoContent)
    }
}

// A known name, a real number, and not negative. Kept out of the post handler's `if`
// so that condition stays simple (detekt caps boolean-operator complexity).
private fun VitalReport.isAcceptable(): Boolean = name in ALLOWED_NAMES && value.isFinite() && value >= 0

// ms rounds to whole numbers; CLS is a small decimal, so keep precision under 10.
private fun fmt(value: Double): String =
    if (value >= DECIMAL_BELOW) "%.0f".format(value) else "%.3f".format(value).trimEnd('0').trimEnd('.')
