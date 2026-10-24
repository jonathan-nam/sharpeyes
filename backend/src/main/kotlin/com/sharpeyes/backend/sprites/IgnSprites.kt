package com.sharpeyes.backend.sprites

import com.sharpeyes.backend.db.IgnSprite
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.post
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant

// The one lookup every typed IGN goes through: what a character looks like, by name. Party saves
// use it for their seats, and the page-side lookup uses it for any name on screen. See V95.

/** An answer is asked for again after this long: a miss is usually a typo or a new character. */
internal val IGN_LOOKUP_RETRY_AFTER = 7.days

/** The longest name the game allows. Nexon's endpoint truncates past it, so longer is no IGN. */
internal const val MAX_IGN_LENGTH = 12

/** How many names one lookup request may ask about. Each new one is an outbound call per world. */
internal const val MAX_LOOKUP_NAMES = 30

/** The Nexon sprite URL already known for each name, lowercased, or null where it found none. */
internal fun knownIgnSprites(names: Collection<String>): Map<String, String?> {
    val keys = names.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()
    if (keys.isEmpty()) return emptyMap()
    return IgnSprite
        .selectAll()
        .where { IgnSprite.nameKey inList keys }
        .associate { it[IgnSprite.nameKey] to it[IgnSprite.spriteImgUrl] }
}

/**
 * Each name's Nexon sprite URL, keyed by the name lowercased, null for a name Nexon does not have.
 *
 * Asks Nexon only about names never asked, or asked longer ago than IGN_LOOKUP_RETRY_AFTER, and
 * records every answer, a miss included, so the next caller does not ask again. Outside any
 * transaction: an outbound call per name would hold a pooled connection for as long as Nexon takes.
 * Never throws.
 */
internal suspend fun lookUpIgns(
    names: Collection<String>,
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
    now: Instant = Clock.System.now(),
): Map<String, String?> {
    val wanted =
        names
            .map { it.trim() }
            .filter { it.isNotEmpty() && it.length <= MAX_IGN_LENGTH && it.none(Char::isWhitespace) }
            .distinctBy { it.lowercase() }
    if (wanted.isEmpty()) return emptyMap()

    val asked =
        dbQuery {
            IgnSprite
                .selectAll()
                .where { IgnSprite.nameKey inList wanted.map { it.lowercase() } }
                .associate { it[IgnSprite.nameKey] to (it[IgnSprite.spriteImgUrl] to it[IgnSprite.lookedUpAt]) }
        }
    val due =
        wanted.filter { name ->
            asked[name.lowercase()]?.let { now - it.second > IGN_LOOKUP_RETRY_AFTER } ?: true
        }

    val found =
        coroutineScope {
            due
                .map { name ->
                    async {
                        val url = nexonLookupService.lookup(name)?.spriteImgUrl
                        // Warmed alongside the lookup, so the first draw is from our own bytes.
                        Triple(name, url, url?.let { spriteCache.fetch(it) })
                    }
                }.awaitAll()
        }
    if (found.isNotEmpty()) {
        dbQuery {
            for ((name, url, bytes) in found) {
                url?.let { spriteCache.store(it, bytes) }
                IgnSprite.upsert(IgnSprite.nameKey) {
                    it[nameKey] = name.lowercase()
                    it[IgnSprite.name] = name
                    it[spriteImgUrl] = url
                    it[lookedUpAt] = now
                }
            }
        }
    }

    val fresh = found.associate { (name, url) -> name.lowercase() to url }
    return wanted.associate { name ->
        val key = name.lowercase()
        key to if (key in fresh) fresh[key] else asked[key]?.first
    }
}

@Serializable
data class SpriteLookupRequest(
    val names: List<String>,
)

/** Each name as sent, to its sprite's proxy path, or null where Nexon has no such character. */
@Serializable
data class SpriteLookupResponse(
    val sprites: Map<String, String?>,
)

fun Route.spriteLookupRoutes(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    post("/lookup") { lookUpRoute(nexonLookupService, spriteCache) }
}

private suspend fun RoutingContext.lookUpRoute(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SpriteLookupRequest>()
    if (request.names.size > MAX_LOOKUP_NAMES) {
        call.respond(HttpStatusCode.BadRequest, "at most $MAX_LOOKUP_NAMES names")
        return
    }
    dbQuery { ensureUser(userId, email) }
    val urls = lookUpIgns(request.names, nexonLookupService, spriteCache)
    call.respond(
        SpriteLookupResponse(
            request.names.associateWith { name -> urls[name.trim().lowercase()]?.let(::spriteProxyPath) },
        ),
    )
}
