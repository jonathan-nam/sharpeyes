package com.sharpeyes.backend.invites

import com.sharpeyes.backend.characters.applyLookup
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.sprites.SpriteCache
import io.ktor.server.routing.RoutingContext
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The one outbound call redeeming a link makes, kept out of InviteRoutes.kt for the reason
// lookUpSprites is kept out of PartyRoutes.kt: it is the only thing there that leaves the process.

/**
 * Fills in what a link cannot carry: level, job and world.
 *
 * A payload names the recipient's characters and says nothing else about them, because the sender
 * has no row for somebody else's character, only seats naming one. So a new account's roster opened
 * with a level and a job on every character it could not answer for. SpriteRefreshJob does pick
 * these up (a null `sprite_checked_at` sorts first), but that is on a clock, and the account looks
 * broken until it comes round.
 *
 * Concurrent and outside any transaction, like lookUpSprites, which does the same work for a roster
 * save. Never throws: NexonLookupService answers null for everything including a timeout, and a
 * character left unasked is one the job asks about later.
 */
internal suspend fun RoutingContext.fillUnaskedCharacters(
    userId: String,
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val unasked = dbQuery { unaskedCharacters(userId) }
    if (unasked.isEmpty()) return

    val found =
        coroutineScope {
            unasked
                .map { character ->
                    async {
                        val lookup = nexonLookupService.lookup(character.name)
                        // Warmed alongside the lookup that produced the URL, as a roster save does.
                        character to (lookup to lookup?.spriteImgUrl?.let { spriteCache.fetch(it) })
                    }
                }.awaitAll()
        }

    val now = Clock.System.now()
    dbQuery {
        for ((character, result) in found) {
            val (lookup, bytes) = result
            if (lookup != null) {
                applyLookup(character.id, userId, lookup, now)
                spriteCache.store(lookup.spriteImgUrl, bytes)
            } else {
                // Asked and unanswered, which is the same record the daily job keeps: a name too
                // new to rank is not re-asked until it comes due like every other.
                Characters.update({ Characters.id eq character.id }) { it[spriteCheckedAt] = now }
            }
        }
    }
}

/** A character nobody has asked Nexon about yet. */
internal data class Unasked(
    val id: Uuid,
    val name: String,
)

/**
 * This account's characters that have never been looked up.
 *
 * `sprite_checked_at` is null only before the first ask, whatever that ask found, so this is the
 * set an invite just wrote and nothing else. See V53.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun unaskedCharacters(userId: String): List<Unasked> =
    Characters
        .selectAll()
        .where { (Characters.userId eq userId) and (Characters.spriteCheckedAt eq null) }
        .map { Unasked(it[Characters.id], it[Characters.name]) }
