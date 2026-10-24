package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// The readable name of a config: the character that runs it, then the boss. There is only ever one
// config per pair (idx_party_character_boss), so the pair names it without an id.
//
// Emitted and resolved back through the same characterSlugsFor, so the two cannot disagree about
// which party a link means. That map is unique by construction: a name it cannot tell apart gets no
// slug, and the config falls back to its uuid rather than to whichever character was read first.

/**
 * A URL-safe form of one name, or null when nothing readable is left of it.
 *
 * Lowercase, and every run of anything else becomes one dash. GMS names are letters and digits, so
 * this is close to a lowercase for the names it will actually see; it is the non-ASCII ones that
 * would otherwise reach a path.
 */
internal fun slugify(text: String): String? =
    text
        .lowercase()
        .map { if (it in 'a'..'z' || it in '0'..'9') it else '-' }
        .joinToString("")
        .split('-')
        .filter { it.isNotEmpty() }
        .joinToString("-")
        .ifEmpty { null }

/**
 * Each of this account's characters by the slug that names it, leaving out any it cannot name.
 *
 * A MapleStory name is unique per WORLD and not per account, so two characters of yours can both be
 * Rune. A doubled name takes "interactive" or "heroic" in front of it, and one doubled even then is
 * left out: absent here means the config addresses itself by uuid, which is the one answer that
 * cannot be the wrong party.
 *
 * The world's own name would read better than its category, and it is not used because nothing
 * populates characters.world_name (V26 says so). Two Runes in two Heroic worlds are what the uuid
 * fallback is for either way.
 *
 * Over every character, not the ones in the world being shown: the slug in a link has to keep
 * meaning the same party when the world lens moves.
 */
internal fun characterSlugsFor(userId: String): Map<Uuid, String> {
    val characters =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .map {
                SluggedCharacter(
                    it[Characters.id],
                    slugify(it[Characters.name]),
                    slugify(it[Characters.worldType]),
                )
            }
    val out = mutableMapOf<Uuid, String>()
    for ((name, sharing) in characters.groupBy { it.name }) {
        if (name == null) continue
        if (sharing.size == 1) out[sharing.single().id] = name else out += toldApartByWorld(name, sharing)
    }
    return out
}

private data class SluggedCharacter(
    val id: Uuid,
    val name: String?,
    val world: String?,
)

/** Of the characters sharing one name, the ones their world category still tells apart. */
private fun toldApartByWorld(
    name: String,
    sharing: List<SluggedCharacter>,
): Map<Uuid, String> =
    sharing
        .groupBy { it.world }
        .filter { (world, stillSharing) -> world != null && stillSharing.size == 1 }
        .map { (world, stillSharing) -> stillSharing.single().id to "$world/$name" }
        .toMap()

/** How a config addresses itself, given its character's slug from [characterSlugsFor]. */
internal fun partySlug(
    partyId: Uuid,
    characterSlug: String?,
    bossKey: String,
): String = if (characterSlug == null) partyId.toString() else "$characterSlug/$bossKey"

/**
 * The config a slug names, or null when no config of this user's has it.
 *
 * One segment is a uuid, which is what an older link carries and what a config with no readable
 * name emits. Anything longer is a character slug and a boss key, and only ever resolves through
 * [characterSlugsFor], so a name that map refuses to tell apart resolves to nothing here instead
 * of to one of the two characters that share it.
 */
internal fun findPartyBySlug(
    path: List<String>,
    userId: String,
): PartyResponse? {
    if (path.isEmpty() || path.size > MAX_SLUG_SEGMENTS) return null
    val partyId = if (path.size == 1) Uuid.parseOrNull(path.single()) else partyIdBySlug(path, userId)
    return partyId?.let { findParty(it, userId) }
}

/** World, character, boss. Nothing a slug can say needs a fourth. */
private const val MAX_SLUG_SEGMENTS = 3

/** The config a character slug and a boss key name, through the one map that hands slugs out. */
private fun partyIdBySlug(
    path: List<String>,
    userId: String,
): Uuid? {
    val characterSlug = path.dropLast(1).joinToString("/")
    val characterId = characterSlugsFor(userId).entries.firstOrNull { it.value == characterSlug }?.key ?: return null
    return Party
        .innerJoin(BossCatalog)
        .selectAll()
        .where {
            (Party.userId eq userId) and
                (Party.characterId eq characterId) and
                (BossCatalog.bossKey eq path.last())
        }.firstOrNull()
        ?.get(Party.id)
}
