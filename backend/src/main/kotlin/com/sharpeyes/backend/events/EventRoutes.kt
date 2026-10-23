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
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

// GET /api/events: a stream of topic names for the signed-in account, each with who made the change
// and what it touched, as server-sent events. Read with fetch rather than EventSource, which cannot
// send the Authorization header (lib/live-events.ts).

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
                    val event = withTimeoutOrNull(HEARTBEAT) { channel.receive() }
                    val frame = event?.let { "event: ${it.topic}\ndata: ${dataOf(it)}\n\n" } ?: ": ping\n\n"
                    writeStringUtf8(frame)
                    flush()
                }
            } finally {
                EventHub.unsubscribe(userId, channel)
            }
        }
    }
}

/** Who and what, for the page to show on the thing that moved. Never who else was told. */
@Serializable
private data class LiveData(
    val actor: String?,
    val image: String?,
    val target: EventTarget,
    val presence: Presence? = null,
)

private fun dataOf(event: Event): String =
    Json.encodeToString(LiveData.serializer(), LiveData(event.actor, event.image, event.target, event.presence))
