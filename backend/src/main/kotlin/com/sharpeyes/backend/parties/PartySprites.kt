package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.sprites.IGN_LOOKUP_RETRY_AFTER
import com.sharpeyes.backend.sprites.SpriteCache
import com.sharpeyes.backend.sprites.lookUpIgns
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.routing.RoutingContext
import kotlin.time.Clock

// The one outbound call a roster save makes: asking Nexon what a character looks like. Kept out of
// PartyRoutes.kt because it is the only thing there that leaves the process, and both roster routes
// (the party's and one week's) go through it.

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
                val stale = seat?.refreshedAt?.let { now - it > IGN_LOOKUP_RETRY_AFTER } ?: true
                seat?.spriteImgUrl == null && stale
            }
    if (wanted.isEmpty()) return emptyMap()

    // The shared IGN lookup, which also answers from what any other screen already asked.
    val found = lookUpIgns(wanted, nexonLookupService, spriteCache, now)
    return wanted.associateWith { found[it.lowercase()] }
}
