package com.sharpeyes.backend.bosses

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.parties.lootFromClear
import com.sharpeyes.backend.parties.unlootFromClear
import com.sharpeyes.backend.services.DetectedBossClear
import com.sharpeyes.backend.users.inActiveWorld
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.min
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Reads and writes for boss clears. `internal` rather than private, like tokenTotalsFor, so the
// tests can exercise these exact queries without standing up Ktor and a JWT.
// All of these must be called from inside a `transaction { }` block.

/**
 * The boss catalog, read once per process.
 *
 * Held rather than re-queried because it is the same rows for every account and cannot change while
 * the process lives: `R__boss_catalog.sql` is a repeatable migration, so a catalog change arrives
 * as a deploy, and Flyway runs it during boot before anything serves. Nothing writes these tables at
 * runtime, which CatalogIsReadOnlyTest keeps true, because that is the assumption this cache is.
 *
 * Worth little today (under a millisecond a call on the dev copy) and worth more per user added: it
 * is identical work repeated for everyone, and the boot warmup fills it before the first request.
 */
@Volatile
private var heldCatalog: List<BossResponse>? = null

internal fun bossCatalog(): List<BossResponse> = heldCatalog ?: readBossCatalog().also { heldCatalog = it }

// A race here costs one extra read and stores an identical answer, so it is left unsynchronised.
private fun readBossCatalog(): List<BossResponse> =
    BossCatalog
        .selectAll()
        .orderBy(BossCatalog.sortOrder)
        .map {
            BossResponse(
                bossKey = it[BossCatalog.bossKey],
                name = it[BossCatalog.name],
                reset = it[BossCatalog.reset],
                iconUrl = it[BossCatalog.iconRefKey]?.let { key -> "/boss-icons/$key" },
                difficulties = it[BossCatalog.difficulties],
            )
        }

/**
 * Every character's clears for the period each boss is currently in, keyed by character id.
 *
 * "Currently" is per boss, not per account: a weekly and a daily boss are in different periods at
 * the same instant, so this asks for one date per cadence rather than filtering on a single one.
 * Filtering on one date would silently return the daily bosses' rows only on the weekly reset day.
 *
 * A boss with no row is absent rather than false. Absent means "no capture has said anything about
 * this boss this period", which is not the same as "not cleared", and only the client showing the
 * matrix can decide how to draw the difference.
 */
internal fun currentBossClearsFor(
    userId: String,
    now: Instant,
): Map<String, List<BossClearResponse>> {
    val currentPeriod = RESET_CADENCES.associateWith { periodStartFor(it, now) }
    return BossClear
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .selectAll()
        .where {
            // Scope to this user's characters, in the world being shown. Without the first the
            // join reaches every user's rows. The second is the site's world lens: see
            // activeWorldFor.
            (Characters.userId eq userId) and
                inActiveWorld(userId) and
                currentPeriod.entries
                    .map { (reset, start) -> (BossCatalog.reset eq reset) and (BossClear.periodStart eq start) }
                    .reduce { a, b -> a or b }
        }.orderBy(BossCatalog.sortOrder)
        .groupBy({ it[BossClear.characterId].toString() }) { it.toBossClearResponse() }
}

/**
 * One past week's clears, weekly bosses only.
 *
 * Weekly only, and that is a correctness choice rather than a shortcut. A week contains seven daily
 * periods, so there is no single answer to "was Zakum cleared that week" to put in a cell; and a
 * week can straddle two months, so the monthly boss has no unambiguous one either. Returning
 * something for them would mean picking one of several true answers and drawing it as if it were
 * the only one. The page hides both cadences when it is showing history.
 */
internal fun weeklyClearsFor(
    userId: String,
    weekStart: LocalDate,
): Map<String, List<BossClearResponse>> =
    BossClear
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .selectAll()
        .where {
            (Characters.userId eq userId) and
                inActiveWorld(userId) and
                (BossCatalog.reset eq WEEKLY_CADENCE) and
                (BossClear.periodStart eq weekStart)
        }.orderBy(BossCatalog.sortOrder)
        .groupBy({ it[BossClear.characterId].toString() }) { it.toBossClearResponse() }

/**
 * The oldest week this user has any weekly clear stored for, or null if they have none.
 *
 * Bounds the back arrow. Without it the picker would step forever into weeks that were never
 * captured, which read identically to a week where nothing was cleared.
 */
internal fun earliestWeekStartFor(userId: String): LocalDate? {
    val earliest = BossClear.periodStart.min()
    return BossClear
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .select(earliest)
        .where {
            // The lens again, and here it changes an ANSWER rather than a list: an unfiltered
            // minimum would bound the back arrow by a week only the other world has clears in, and
            // every step back into it would draw an empty grid that looks like a week off.
            (Characters.userId eq userId) and
                inActiveWorld(userId) and
                (BossCatalog.reset eq WEEKLY_CADENCE)
        }.firstOrNull()
        ?.get(earliest)
}

private fun ResultRow.toBossClearResponse() =
    BossClearResponse(
        bossKey = this[BossCatalog.bossKey],
        cleared = this[BossClear.cleared],
        periodStart = this[BossClear.periodStart].toString(),
        capturedAt = this[BossClear.capturedAt].toString(),
    )

/**
 * Whether this character's boss is ticked cleared for the period [on] falls in.
 *
 * A missing row reads as not cleared. Absent means nothing has said anything about the boss this
 * period, and the caller is asking so it can file what a clear guarantees, which needs the tick on
 * record rather than merely not contradicted. See setSoloDifficulty.
 */
internal fun bossClearedOn(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    on: LocalDate,
): Boolean =
    BossClear
        .selectAll()
        .where {
            (BossClear.characterId eq characterId) and
                (BossClear.bossCatalogId eq bossCatalogId) and
                (BossClear.periodStart eq periodOf(reset, on))
        }.firstOrNull()
        ?.get(BossClear.cleared) == true

/**
 * Ticks one character's boss cleared for the period it is currently in, or un-ticks it.
 *
 * The same row a capture writes and the matrix reads, so ticking a cell and uploading a planner are
 * two ways of saying one thing rather than two places to keep it. source_screenshot_id is left null
 * on purpose, as setPartyClear leaves it: it is what tells a hand tick from a capture, and the next
 * capture replaces the row with one that has a screenshot behind it.
 *
 * Returns false if the character is not this user's, or the boss key is not in the catalog. Refused
 * rather than written: a clear filed against a character or a boss nobody named would still be read
 * as somebody's answer.
 */
internal fun setBossClearByHand(
    userId: String,
    characterId: Uuid,
    bossKey: String,
    cleared: Boolean,
    now: Instant,
): Boolean {
    val owned =
        Characters
            .selectAll()
            .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
            .firstOrNull() != null
    val boss =
        if (!owned) null else BossCatalog.selectAll().where { BossCatalog.bossKey eq bossKey }.firstOrNull()
    if (boss == null) return false

    BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { row ->
        row[BossClear.characterId] = characterId
        row[bossCatalogId] = boss[BossCatalog.id]
        row[periodStart] = periodStartFor(boss[BossCatalog.reset], now)
        row[BossClear.cleared] = cleared
        row[capturedAt] = now
        row[sourceScreenshotId] = null
    }
    val day = now.toLocalDateTime(TimeZone.UTC).date
    if (cleared) {
        lootFromClear(characterId, boss[BossCatalog.id], boss[BossCatalog.reset], day, now)
    } else {
        unlootFromClear(characterId, boss[BossCatalog.id], boss[BossCatalog.reset], day)
    }
    return true
}

/**
 * Files a planner read against the character it belongs to.
 *
 * Pending rows are written too, not only clears: a planner shows every boss the character runs
 * with its state, so a (boss, period, cleared=false) row IS that character's routine, and without
 * it "pending" would be indistinguishable from "never seen". See V10__boss_clear.sql.
 */
internal fun upsertBossClears(
    characterId: Uuid,
    clears: List<DetectedBossClear>,
    screenshotId: Uuid,
    capturedAt: Instant,
) {
    if (clears.isEmpty()) return
    val catalog = BossCatalog.selectAll().associateBy { it[BossCatalog.bossKey] }
    for (clear in clears) {
        // The reader can only emit a key it matched against the generated catalog, the same
        // manifest boss_catalog is seeded from, so an unmatched one means the two have drifted.
        // Loud, for the reason upsertTokenCounts is loud: the silent version of this dropped
        // every token when the parser changed its key format and no test noticed.
        val row =
            catalog[clear.bossKey]
                ?: error(
                    "No boss_catalog row with boss_key='${clear.bossKey}'. The planner reader " +
                        "and the catalog have drifted. See catalog/bosses.yaml.",
                )
        // Per boss, because cadences differ: a daily and a weekly boss read from one capture
        // belong to two different periods.
        val period = periodStartFor(row[BossCatalog.reset], capturedAt)
        BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { r ->
            r[BossClear.characterId] = characterId
            r[bossCatalogId] = row[BossCatalog.id]
            r[periodStart] = period
            r[cleared] = clear.cleared
            r[BossClear.capturedAt] = capturedAt
            r[sourceScreenshotId] = screenshotId
        }
        // A capture files what a solo clear guarantees too, or takes it back on a boss it reads as
        // pending. Skipping it here would make a ticked clear and a captured one disagree about
        // whether the pieces exist, silently. See LootFromClear.kt.
        val day = capturedAt.toLocalDateTime(TimeZone.UTC).date
        if (clear.cleared) {
            lootFromClear(characterId, row[BossCatalog.id], row[BossCatalog.reset], day, capturedAt)
        } else {
            unlootFromClear(characterId, row[BossCatalog.id], row[BossCatalog.reset], day)
        }
    }
}
