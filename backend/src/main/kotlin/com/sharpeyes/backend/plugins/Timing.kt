package com.sharpeyes.backend.plugins

import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.hooks.CallSetup
import io.ktor.server.application.hooks.ResponseSent
import io.ktor.server.application.install
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.util.AttributeKey
import org.slf4j.LoggerFactory
import kotlin.time.Duration
import kotlin.time.TimeSource

private val log = LoggerFactory.getLogger("Timing")

private val START = AttributeKey<TimeSource.Monotonic.ValueTimeMark>("RequestStart")
private val SPANS = AttributeKey<MutableList<Span>>("RequestSpans")
private val REASON = AttributeKey<String>("FailureReason")

/**
 * Why this request is about to fail, carried onto its own log line.
 *
 * A status alone does not say what a user hit. `GET /api/parties 401` is sent by a browser whose
 * token has not loaded yet, by one whose token expired, and by a probe with no header at all, and
 * telling those apart from the log is the whole point of recording it.
 */
fun ApplicationCall.failing(reason: String) {
    attributes.put(REASON, reason)
}

private data class Span(
    val name: String,
    val millis: Double,
)

/**
 * Where the time went, on every request.
 *
 * Emits a `Server-Timing` header, which is a web standard rather than something of
 * ours: Chrome and Firefox render it natively in the Network panel's Timing tab. So
 * the frontend gets a per-request breakdown of the backend's own work with no client
 * code, no dashboard, and no agent to run.
 *
 * The alternative was logging durations and grepping them, which tells you what was
 * slow only if you already suspected it was. This puts the number in front of you
 * next to the request that produced it.
 */
val Timing =
    createApplicationPlugin("Timing") {
        on(CallSetup) { call ->
            call.attributes.put(START, TimeSource.Monotonic.markNow())
            call.attributes.put(SPANS, mutableListOf())
        }

        // Set the header before the response body goes out. ResponseSent is too
        // late to add one.
        onCallRespond { call, _ ->
            val start = call.attributes.getOrNull(START) ?: return@onCallRespond
            val spans = call.attributes.getOrNull(SPANS).orEmpty()
            val total = start.elapsedMillis()

            val header =
                (spans + Span("total", total))
                    .joinToString(", ") { "${it.name};dur=${"%.1f".format(it.millis)}" }
            call.response.headers.append("Server-Timing", header, safeOnly = false)
        }

        on(ResponseSent) { call ->
            val start = call.attributes.getOrNull(START) ?: return@on
            val total = start.elapsedMillis()
            val spans = call.attributes.getOrNull(SPANS).orEmpty()
            val detail =
                if (spans.isEmpty()) {
                    ""
                } else {
                    spans.joinToString(
                        " ",
                    ) { "${it.name}=${"%.0f".format(it.millis)}ms" }
                }

            // Slow requests get a louder level, so "the app feels slow" becomes a
            // grep rather than a hunch. Failing ones get the same treatment, and for the same
            // reason: "it errored for me" has to be answerable without the user's browser.
            val status = call.response.status()?.value
            val slow = total > SLOW_REQUEST_MS
            val failed = status != null && status >= FIRST_ERROR_STATUS
            val line =
                buildString {
                    if (failed) append("FAIL ")
                    if (slow) append("SLOW ")
                    append(call.request.httpMethod.value).append(' ')
                    append(call.request.path()).append(' ')
                    append(status).append(' ')
                    append("%.0f".format(total)).append("ms")
                    if (detail.isNotEmpty()) append(' ').append(detail)
                    call.attributes.getOrNull(REASON)?.let { append(" reason=").append(it) }
                }
            when {
                status != null && status >= FIRST_SERVER_ERROR_STATUS -> log.error(line)
                failed || slow -> log.warn(line)
                else -> log.info(line)
            }
        }
    }

private const val SLOW_REQUEST_MS = 500.0
private const val FIRST_ERROR_STATUS = 400
private const val FIRST_SERVER_ERROR_STATUS = 500
private const val MICROS_PER_MILLI = 1000.0

private fun TimeSource.Monotonic.ValueTimeMark.elapsedMillis(): Double =
    elapsedNow().inWholeMicroseconds / MICROS_PER_MILLI

/**
 * Time one named step inside a request and attach it to that request's Server-Timing.
 *
 * Use it for the parts that can actually be slow and that you would otherwise have to
 * guess between, the vision parse, the Nexon lookup, a database round trip:
 *
 *     val result = call.span("vision") { parser.parseScreenshot(bytes, type) }
 */
suspend fun <T> ApplicationCall.span(
    name: String,
    block: suspend () -> T,
): T {
    val mark = TimeSource.Monotonic.markNow()
    try {
        return block()
    } finally {
        attributes
            .getOrNull(SPANS)
            ?.add(Span(name, mark.elapsedMillis()))
    }
}

/**
 * Attach a span that was timed somewhere [span] cannot reach.
 *
 * [span] wraps a suspend block, and the work worth splitting inside a `dbQuery { }` is not suspend:
 * Exposed's transaction takes a plain lambda, which is what stops a nested dbQuery and also stops a
 * span. So the caller measures with `measureTime` and hands the result here.
 *
 * Same output either way, a `Server-Timing` entry and a name on the log line, so a reader cannot
 * tell which one produced it.
 */
fun ApplicationCall.addSpan(
    name: String,
    elapsed: Duration,
) {
    attributes
        .getOrNull(SPANS)
        ?.add(Span(name, elapsed.inWholeMicroseconds / MICROS_PER_MILLI))
}

fun Application.configureTiming() {
    install(Timing)
}
