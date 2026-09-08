package com.sharpeyes.backend.sprites

import com.sharpeyes.backend.characters.applyLookup
import com.sharpeyes.backend.db.CharacterSprite
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.services.NexonLookupService
import io.ktor.server.application.Application
import io.ktor.server.application.log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A character's appearance is theirs to change whenever they like, and nothing tells us when they
// have. So it is re-asked on a clock, and a day is the resolution: an outfit change showing up
// within a day is not worth a lookup per page view.
private val SPRITE_MAX_AGE = 1.days

// How often to look for characters that have come due. Not the refresh interval: a tick refreshes
// only what is older than SPRITE_MAX_AGE, so a short one costs a cheap indexed query and spreads
// the work of a day's worth of characters instead of doing all of it on the hour.
private val TICK_INTERVAL = 30.minutes

// Ceiling on one tick's outbound calls. Each character costs FOUR requests to Nexon's ranking
// endpoint (the world fan-out) plus one image fetch, against a community-run API this app is a guest
// on. At a tick every 30 minutes this still clears 960 characters a day, far past what the app holds.
private const val BATCH = 20

// Between characters within a tick. The fan-out already makes 4 concurrent calls per character;
// stacking those back to back is what a burst looks like from the far end.
private val PACING = 2.seconds

// An orphan is a cached sprite nothing points at any more: the character it belonged to changed
// outfit, was deleted, or was renamed. Kept for a week rather than deleted at the moment it is
// orphaned, so flipping an outfit back does not re-fetch, and so a bug that drops a reference for a
// day does not also throw away the bytes.
private val ORPHAN_GRACE = 7.days

/**
 * Re-asks Nexon what each character looks like, about once a day per character.
 *
 * Outfits change and Nexon's URL encodes the outfit, so the cached bytes never go stale (a new
 * outfit is a new URL) but the URL on the character does. That is what this refreshes; the byte
 * cache follows from it.
 *
 * Party seats that are not one of this account's characters are deliberately not RE-ASKED here.
 * Those have their own policy in PartySprites.kt (fill when empty, retry a miss after a week), and
 * putting every seat of every roster on a daily lookup clock would multiply the ranking calls by
 * roster size. Their bytes are still cached, by [warmUnfetched]: that needs no lookup, because the
 * URL is already stored. So a seat's outfit can go stale while its art is served from our own cache.
 */
class SpriteRefreshJob(
    private val nexonLookupService: NexonLookupService,
    private val spriteCache: SpriteCache,
) {
    /** One character due for a re-ask. */
    internal data class Due(
        val id: Uuid,
        val userId: String,
        val name: String,
    )

    /**
     * Refreshes up to [BATCH] characters that have not been asked about within [SPRITE_MAX_AGE].
     *
     * Returns how many were asked about, not how many changed: a character whose outfit is the same
     * still counts, having cost the same lookup.
     */
    suspend fun runOnce(now: Instant = Clock.System.now()): Int {
        val due = transaction { dueCharacters(now) }
        for ((index, character) in due.withIndex()) {
            if (index > 0) delay(PACING)
            refresh(character, Clock.System.now())
        }
        return due.size
    }

    /**
     * Fetches the bytes for registered sprites that have none yet, and returns how many landed.
     *
     * Separate from [runOnce] because it needs no ranking lookup: the URL is already known, so this
     * is one image fetch rather than the four ranking calls plus a fetch that finding a URL costs.
     *
     * It is also the only thing that ever caches a party seat who is not one of your characters.
     * Those are deliberately not on the daily lookup clock (see the class comment), so without this
     * they would stay registered-but-byteless forever: drawn via the redirect, but redirected to
     * Nexon on every page load, which is the whole problem this cache exists to solve.
     */
    suspend fun warmUnfetched(limit: Int = BATCH): Int {
        val pending = transaction { unfetchedSprites(limit) }
        var stored = 0
        for ((index, url) in pending.withIndex()) {
            if (index > 0) delay(PACING)
            if (warmOne(url)) stored++
        }
        return stored
    }

    /**
     * Fetches and stores the bytes for one known URL. True if bytes landed.
     *
     * The seam every test uses, because [warmUnfetched] picks its own work from the whole table: a
     * test calling that against the shared dev database warms every byteless row in it, which is how
     * a 9-byte stub ended up written over 14 real sprites. A test names its URL.
     */
    internal suspend fun warmOne(url: String): Boolean {
        val bytes = spriteCache.fetch(url) ?: return false
        transaction { spriteCache.store(url, bytes) }
        return true
    }

    internal suspend fun refresh(
        character: Due,
        now: Instant,
    ) {
        val lookup = nexonLookupService.lookup(character.name)
        // Outside the transaction: two outbound calls, and holding a pooled connection across them
        // ties it up for as long as Nexon takes to answer.
        val bytes = lookup?.spriteImgUrl?.let { spriteCache.fetch(it) }

        transaction {
            // A failed lookup leaves the name, level, job and sprite alone rather than blanking
            // them: it is far likelier that Nexon had a bad minute than that the character stopped
            // existing. `sprite_checked_at` still moves, which is what keeps an unresolvable name
            // out of the next tick's batch.
            if (lookup != null) {
                applyLookup(character.id, character.userId, lookup, now)
                spriteCache.store(lookup.spriteImgUrl, bytes)
            }
            Characters.update({ Characters.id eq character.id }) {
                it[spriteCheckedAt] = now
            }
        }
    }

    /**
     * The characters that have not been asked about within [SPRITE_MAX_AGE], oldest first.
     *
     * [limit] is a parameter rather than always [BATCH] so a test can ask for the whole set: this
     * query is account-wide by design, and a test asserting on a batch of 20 would be asserting
     * about whatever else happens to be in the database.
     *
     * Must be called from inside a `transaction { }` block.
     */
    internal fun dueCharacters(
        now: Instant,
        limit: Int = BATCH,
    ): List<Due> =
        Characters
            .selectAll()
            .where {
                // A character with no sprite at all is included: a lookup that came back empty when
                // they were added is worth re-asking, since a brand-new character ranks eventually.
                (Characters.spriteCheckedAt eq null) or (Characters.spriteCheckedAt less (now - SPRITE_MAX_AGE))
            }.orderBy(Characters.spriteCheckedAt to SortOrder.ASC_NULLS_FIRST)
            .limit(limit)
            .map { Due(it[Characters.id], it[Characters.userId], it[Characters.name]) }
}

/**
 * Registered sprites with no bytes yet, oldest first.
 *
 * Top-level, like its neighbours below, because it reads the table and nothing else.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun unfetchedSprites(limit: Int = BATCH): List<String> =
    CharacterSprite
        .selectAll()
        .where { CharacterSprite.image eq null }
        .orderBy(CharacterSprite.createdAt to SortOrder.ASC)
        .limit(limit)
        .map { it[CharacterSprite.sourceUrl] }

/** Every sprite URL any row currently points at, by proxy key. */
private fun referencedSprites(): Map<String, String> {
    val characterUrls = Characters.selectAll().mapNotNull { it[Characters.spriteImgUrl] }
    val seatUrls = PartyMember.selectAll().mapNotNull { it[PartyMember.spriteImgUrl] }
    return (characterUrls + seatUrls).associateBy { spriteKey(it) }
}

/**
 * Registers any sprite URL a row points at that the cache has never heard of.
 *
 * The safety net for the one failure this cache can produce that is worse than what it replaced. The
 * DTO hands out a proxy path for any stored URL, computed without touching this table, so a URL that
 * was never registered is a path the route answers 404 for and an image that is simply gone. That is
 * what happened to every sprite predating V53 (see V54__backfill_character_sprite.sql), and a write
 * path added later that forgets to register would do it again.
 *
 * Registered with no bytes, which is the state the route redirects to Nexon for, so an unregistered
 * sprite is drawn from the moment this runs and cached when the refresh next reaches it.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun registerUnknownSprites(): Int {
    val referenced = referencedSprites()
    if (referenced.isEmpty()) return 0
    val known =
        CharacterSprite
            .select(CharacterSprite.urlSha256)
            .where { CharacterSprite.urlSha256 inList referenced.keys.toList() }
            .map { it[CharacterSprite.urlSha256] }
            .toSet()
    val missing = referenced.filterKeys { it !in known }
    val now = Clock.System.now()
    missing.forEach { (key, url) ->
        CharacterSprite.insertIgnore {
            it[urlSha256] = key
            it[sourceUrl] = url
            it[createdAt] = now
        }
    }
    return missing.size
}

/**
 * Deletes cached sprites nothing points at, once they are past [ORPHAN_GRACE].
 *
 * Without this the table gains a row per outfit change per character and never loses one. The
 * reference check is done here rather than in SQL because it needs [spriteKey]: the tables store the
 * URL and this one is keyed by its hash.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun sweepOrphanedSprites(now: Instant): Int {
    val referenced = referencedSprites().keys

    val cutoff = now - ORPHAN_GRACE
    val orphans =
        CharacterSprite
            .selectAll()
            .where { CharacterSprite.createdAt less cutoff }
            .map { it[CharacterSprite.urlSha256] }
            .filter { it !in referenced }
    if (orphans.isEmpty()) return 0
    return CharacterSprite.deleteWhere { urlSha256 inList orphans }
}

/**
 * Starts the refresh loop for the life of the application.
 *
 * One process refreshes, which is true of this deployment (a single Lightsail instance running
 * docker-compose) and is the only reason no row-level claim is taken. Two instances would each do
 * the work: wasteful against Nexon, but every write here is idempotent, so not wrong.
 */
fun Application.startSpriteRefresh(job: SpriteRefreshJob) {
    // On Dispatchers.IO, not the Application's own dispatcher, which is Netty's event loop. The
    // transactions below are blocking JDBC, so a bare `launch` put a tick's worth of them on one of
    // the two threads that also serve every request. Nothing here is on a request's path, so it
    // keeps plain `transaction` rather than dbQuery: this launch is what takes it off the loop.
    launch(Dispatchers.IO) {
        // Registering costs one query and no outbound call, and an unregistered sprite is a BROKEN
        // IMAGE rather than an uncached one, so it does not wait for the first tick.
        runCatching { transaction { registerUnknownSprites() } }
            .onSuccess { if (it > 0) log.info("Sprite refresh: registered $it sprite(s) on boot") }
            .onFailure { log.warn("Sprite registration on boot failed", it) }

        // The lookups themselves are not on boot. A deploy restarts the process, and refreshing on
        // every restart turns a busy afternoon of deploys into a burst of lookups that the clock
        // exists to avoid.
        delay(TICK_INTERVAL)
        while (true) {
            runCatching {
                val registered = transaction { registerUnknownSprites() }
                val asked = job.runOnce()
                // After the lookups, so a URL they just registered is warmed by this same tick.
                val warmed = job.warmUnfetched()
                val swept = transaction { sweepOrphanedSprites(Clock.System.now()) }
                // Silent on a tick that did nothing, which is most of them.
                if (registered + asked + warmed + swept > 0) {
                    log.info(
                        "Sprite refresh: registered $registered, asked about $asked character(s), " +
                            "warmed $warmed, swept $swept cached sprite(s)",
                    )
                }
            }.onFailure {
                // The loop outlives one bad tick. A lookup that throws, a database blip: the next
                // tick is 30 minutes away and the batch is picked fresh, so nothing is lost by
                // giving up on this one.
                log.warn("Sprite refresh tick failed", it)
            }
            delay(TICK_INTERVAL)
        }
    }
}
