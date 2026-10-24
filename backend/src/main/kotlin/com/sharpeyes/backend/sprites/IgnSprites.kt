package com.sharpeyes.backend.sprites

import com.sharpeyes.api.sprites.SpriteLookupRequest
import com.sharpeyes.api.sprites.SpriteLookupResponse
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
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant

// The one lookup every typed IGN goes through: what a character looks like and what job it is, by
// name. Party saves use it for their seats, and the page-side lookup uses it for any name on
// screen. See V95 and V96.

/** An answer is asked for again after this long: a miss is usually a typo or a new character. */
internal val IGN_LOOKUP_RETRY_AFTER = 7.days

/** The longest name the game allows. Nexon's endpoint truncates past it, so longer is no IGN. */
internal const val MAX_IGN_LENGTH = 12

/** How many names one lookup request may ask about. Each new one is an outbound call per world. */
internal const val MAX_LOOKUP_NAMES = 30

/** What Nexon said about one IGN: its sprite URL and job, both null for a name it does not have. */
internal data class IgnAnswer(
    val spriteImgUrl: String?,
    val jobName: String?,
)

/** What is already recorded for each name, keyed lowercased. Names never asked are absent. */
internal fun knownIgns(names: Collection<String>): Map<String, IgnAnswer> {
    val keys = names.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()
    if (keys.isEmpty()) return emptyMap()
    return IgnSprite
        .selectAll()
        .where { IgnSprite.nameKey inList keys }
        .associate { it[IgnSprite.nameKey] to IgnAnswer(it[IgnSprite.spriteImgUrl], it[IgnSprite.jobName]) }
}

/**
 * Each name's answer, keyed by the name lowercased.
 *
 * Asks Nexon only about names never asked, asked longer ago than IGN_LOOKUP_RETRY_AFTER, or found
 * before the job was kept (V96), and records every answer, a miss included, so the next caller does
 * not ask again. Outside any transaction: an outbound call per name would hold a pooled connection
 * for as long as Nexon takes. Never throws.
 */
internal suspend fun lookUpIgns(
    names: Collection<String>,
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
    now: Instant = Clock.System.now(),
): Map<String, IgnAnswer> {
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
                .associate {
                    it[IgnSprite.nameKey] to
                        Pair(IgnAnswer(it[IgnSprite.spriteImgUrl], it[IgnSprite.jobName]), it[IgnSprite.lookedUpAt])
                }
        }
    val due =
        wanted.filter { name ->
            val (answer, at) = asked[name.lowercase()] ?: return@filter true
            now - at > IGN_LOOKUP_RETRY_AFTER || (answer.spriteImgUrl != null && answer.jobName == null)
        }

    val found =
        coroutineScope {
            due
                .map { name ->
                    async {
                        val result = nexonLookupService.lookup(name)
                        val url = result?.spriteImgUrl
                        // Warmed alongside the lookup, so the first draw is from our own bytes.
                        Triple(name, IgnAnswer(url, result?.jobName), url?.let { spriteCache.fetch(it) })
                    }
                }.awaitAll()
        }
    if (found.isNotEmpty()) {
        dbQuery {
            for ((name, answer, bytes) in found) {
                answer.spriteImgUrl?.let { spriteCache.store(it, bytes) }
                IgnSprite.upsert(IgnSprite.nameKey) {
                    it[nameKey] = name.lowercase()
                    it[IgnSprite.name] = name
                    it[spriteImgUrl] = answer.spriteImgUrl
                    it[jobName] = answer.jobName
                    it[lookedUpAt] = now
                }
            }
        }
    }

    val fresh = found.associate { (name, answer) -> name.lowercase() to answer }
    return wanted.associate { name ->
        val key = name.lowercase()
        key to (fresh[key] ?: asked[key]?.first ?: IgnAnswer(null, null))
    }
}

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
    val answers = lookUpIgns(request.names, nexonLookupService, spriteCache)
    val answerOf = { name: String -> answers[name.trim().lowercase()] }
    call.respond(
        SpriteLookupResponse(
            sprites = request.names.associateWith { answerOf(it)?.spriteImgUrl?.let(::spriteProxyPath) },
            jobs = request.names.associateWith { answerOf(it)?.jobName },
        ),
    )
}
