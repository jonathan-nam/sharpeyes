package com.sharpeyes.backend.events

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.friends.faceOf
import com.sharpeyes.backend.parties.audienceOf
import com.sharpeyes.backend.parties.imageOf
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

// POST /api/presence: where you are on a page, sent to everybody you share a party with who has the
// same page open. Nothing is stored. It rides the live events' NOTIFY (Publish.kt), the one path that
// reaches a browser on either replica, and a ping that is dropped is replaced by the next.

/** Below this between two pings from one account, the later is dropped. Per replica. */
private val MIN_GAP = 50.milliseconds

/** How long who-shares-a-party-with-you and your face are reused before being read again. */
private val REUSE = 1.minutes

private const val MAX_KEY = 80

/**
 * One account's place on a page.
 *
 * `scope` is the `data-presence` key of the region the pointer is over, and `x`/`y` are fractions of
 * that region's box, so each browser draws the cursor over the same thing whatever its own layout.
 * With no scope they are a fraction of the page's width and pixels from its top. `target` is the key
 * of the control being pressed or typed into, which gets the outline.
 */
@Serializable
internal data class Presence(
    val page: String,
    /** False when they left the page. */
    val here: Boolean = true,
    val scope: String? = null,
    val x: Double? = null,
    val y: Double? = null,
    val target: String? = null,
    val name: String? = null,
)

private class Reused<T>(
    val value: T,
    val at: Instant,
)

private val peers = ConcurrentHashMap<String, Reused<Set<String>>>()
private val faces = ConcurrentHashMap<String, Reused<Pair<String?, String?>>>()
private val lastPing = ConcurrentHashMap<String, Instant>()

fun Route.presenceRoutes() {
    post {
        val (userId, _) = call.principalIdAndEmail()
        val ping = call.receive<Presence>()
        val now = Clock.System.now()
        val last = lastPing[userId]
        val valid =
            ping.page.length <= MAX_KEY &&
                (ping.scope?.length ?: 0) <= MAX_KEY &&
                (ping.target?.length ?: 0) <= MAX_KEY &&
                listOfNotNull(ping.x, ping.y).all { it.isFinite() }
        when {
            !valid -> call.respond(HttpStatusCode.BadRequest)
            // Leaving is never dropped: it is the one ping that clears a cursor rather than moving it.
            ping.here && last != null && now - last < MIN_GAP -> call.respond(HttpStatusCode.NoContent)
            else -> {
                lastPing[userId] = now
                dbQuery {
                    val audience = reused(peers, userId, now) { peersOf(userId) }
                    if (audience.isNotEmpty()) {
                        val (name, image) = reused(faces, userId, now) { faceOf(userId).first to imageOf(userId) }
                        send(Event(audience.toList(), Topic.PRESENCE, userId, image, presence = ping.copy(name = name)))
                    }
                }
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}

private fun <T> reused(
    cache: ConcurrentHashMap<String, Reused<T>>,
    userId: String,
    now: Instant,
    read: () -> T,
): T {
    val held = cache[userId]
    if (held != null && now - held.at < REUSE) return held.value
    return read().also { cache[userId] = Reused(it, now) }
}

/** Everybody in a standing party with [userId], as leader or member, but them. Inside a transaction. */
private fun peersOf(userId: String): Set<String> {
    val led =
        Party
            .selectAll()
            .where { (Party.userId eq userId) and (Party.standing eq true) }
            .map { it[Party.id] }
    val seated =
        PartyMember
            .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
            .join(Party, JoinType.INNER, PartyMember.partyId, Party.id)
            .selectAll()
            .where { (Characters.userId eq userId) and (PartyMember.standing eq true) and (Party.standing eq true) }
            .map { it[Party.id] }
    return (led + seated).distinct().flatMap { audienceOf(it) }.toSet() - userId
}
