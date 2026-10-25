package com.sharpeyes.backend.characters

import com.sharpeyes.api.characters.CharacterResponse
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.services.NexonLookupResult
import com.sharpeyes.backend.sprites.spriteProxyPath
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Shared by CharacterRoutes.kt's ownership-checked read/update/refresh/delete
// handlers. Must be called from inside a `transaction { }` block.
fun findOwnedCharacter(
    characterId: Uuid,
    userId: String,
): CharacterResponse? =
    Characters
        .selectAll()
        .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
        .singleOrNull()
        ?.toCharacterResponse()

/**
 * Writes what the ranking lookup found onto a character.
 *
 * The WORLD is the part worth reading twice. It moves with the rest, and since the per-character
 * world control is gone this is the only thing that can ever correct a wrong one: a refresh that
 * recorded the world without acting on it would leave a character stuck in the wrong world for
 * good, with nothing on any screen disagreeing with it.
 *
 * A null world leaves both columns alone rather than clearing them. That is a world this build does
 * not know, not a character that has stopped having one, and blanking it would throw away the last
 * answer anybody had.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun applyLookup(
    characterId: Uuid,
    userId: String,
    lookup: NexonLookupResult,
    now: Instant,
) {
    Characters.update({ (Characters.id eq characterId) and (Characters.userId eq userId) }) { row ->
        // How a row typed before the name was authoritative picks up its real capitalisation. Safe
        // for everything pointing at it: a seat carries the character's id, and every join that
        // goes by name folds case first (see PartySeats.ownCharacterIds).
        row[Characters.name] = lookup.name
        row[Characters.level] = lookup.level
        row[Characters.jobName] = lookup.jobName
        lookup.world?.let {
            row[Characters.worldName] = it.displayName
            row[Characters.worldType] = it.worldType
        }
        row[Characters.spriteImgUrl] = lookup.spriteImgUrl
        row[Characters.spriteRefreshedAt] = now
        // Asking by hand counts as asking, so a character refreshed manually is not also picked up
        // by the daily job an hour later.
        row[Characters.spriteCheckedAt] = now
        row[Characters.updatedAt] = now
    }
}

fun ResultRow.toCharacterResponse() =
    CharacterResponse(
        id = this[Characters.id].toString(),
        name = this[Characters.name],
        level = this[Characters.level],
        jobName = this[Characters.jobName],
        worldName = this[Characters.worldName],
        worldType = this[Characters.worldType],
        // The proxy path, never Nexon's URL. See spriteProxyPath.
        spriteImgUrl = this[Characters.spriteImgUrl]?.let { spriteProxyPath(it) },
        spriteRefreshedAt = this[Characters.spriteRefreshedAt]?.toString(),
        createdAt = this[Characters.createdAt].toString(),
        updatedAt = this[Characters.updatedAt].toString(),
    )
