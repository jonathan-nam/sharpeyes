package com.sharpeyes.backend.events

import com.sharpeyes.backend.plugins.principalIdAndEmail
import io.ktor.http.CacheControl
import io.ktor.http.ContentType
import io.ktor.server.application.call
import io.ktor.server.response.cacheControl
import io.ktor.server.response.header
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

// GET /api/events: a stream of topic names for the signed-in account, as server-sent events. Read
// with fetch rather than EventSource, which cannot send the Authorization header (lib/live-events.ts).

/** Under nginx's 60s read timeout, so an idle stream is never cut as a hung upstream. */
private val HEARTBEAT = 25.seconds

/**
 * How long one stream lives. The token was checked once, at the start, so a stream is ended well
 * inside its lifetime and the page reconnects with a fresh one.
 */
private val LIFETIME = 10.minutes

fun Route.eventRoutes() {
    get {
        val (userId, _) = call.principalIdAndEmail()
        call.response.cacheControl(CacheControl.NoCache(null))
        // nginx buffers proxied responses by default, which would hold every event until the
        // buffer filled. This turns that off for this response alone.
        call.response.header("X-Accel-Buffering", "no")
        call.respondBytesWriter(contentType = ContentType.Text.EventStream) {
            val channel = EventHub.subscribe(userId)
            val until = Clock.System.now() + LIFETIME
            try {
                writeStringUtf8(": open\n\n")
                flush()
                while (Clock.System.now() < until) {
                    val topic = withTimeoutOrNull(HEARTBEAT) { channel.receive() }
                    writeStringUtf8(if (topic == null) ": ping\n\n" else "event: $topic\ndata: {}\n\n")
                    flush()
                }
            } finally {
                EventHub.unsubscribe(userId, channel)
            }
        }
    }
}
