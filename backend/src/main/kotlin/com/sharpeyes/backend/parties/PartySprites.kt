package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.sprites.SpriteCache
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.routing.RoutingContext
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days

// The one outbound call a roster save makes: asking Nexon what a character looks like. Kept out of
// PartyRoutes.kt because it is the only thing there that leaves the process, and both roster routes
// (the party's and one week's) go through it.

// A lookup is worth retrying after this long. A name that resolved to nothing is usually a typo or
// a character too new to rank, and neither is worth an outbound call on every save.
private val SPRITE_RETRY_AFTER = 7.days

/**
 * Sprites for the members that need one, looked up by character name.
 *
 * A member who is one of your own characters is skipped: those read the character's own sprite.
 * A name already carrying a sprite is left alone, and one whose lookup came back empty recently is
 * not asked again. Never throws.
 */
internal suspend fun RoutingContext.lookUpSprites(
    userId: String,
    members: List<String>,
    email: String,
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
): Map<String, String?> {
    val known =
        dbQuery {
            ensureUser(userId, email)
            seatSpritesByCharacter(userId)
        }
    val now = Clock.System.now()
    val wanted =
        members
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .filter { name ->
                val seat = known[name]
                val stale = seat?.refreshedAt?.let { now - it > SPRITE_RETRY_AFTER } ?: true
                seat?.spriteImgUrl == null && stale
            }
    if (wanted.isEmpty()) return emptyMap()

    // Outside the transaction above: an outbound HTTP call per name, and holding a connection
    // across it would tie up the pool for as long as Nexon takes to answer.
    val found =
        coroutineScope {
            wanted
                .map { name ->
                    async {
                        val url = nexonLookupService.lookup(name)?.spriteImgUrl
                        // Warmed here, alongside the lookup that produced the URL, so the seat is
                        // drawn from our own bytes the first time the roster renders.
                        name to (url to url?.let { spriteCache.fetch(it) })
                    }
                }.awaitAll()
                .toMap()
        }
    dbQuery {
        found.values.forEach { (url, bytes) -> url?.let { spriteCache.store(it, bytes) } }
    }
    return found.mapValues { (_, urlAndBytes) -> urlAndBytes.first }
}
