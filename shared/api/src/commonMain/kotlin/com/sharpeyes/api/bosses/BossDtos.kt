package com.sharpeyes.api.bosses

import com.sharpeyes.api.AbsentOnCachedPayload
import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/boss.ts field-for-field.

@Serializable
data class BossResponse(
    val bossKey: String,
    val name: String,
    // WEEKLY / DAILY / MONTHLY. The client needs it to label a column's cadence, and to know that
    // two bosses in the same matrix are not counting the same span of time.
    val reset: String,
    // The boss's planner portrait, backend-relative and resolved by apiAssetUrl(). Null only if
    // the seed has no art for it, which catalog/build.py refuses to let happen.
    val iconUrl: String? = null,
    // The modes it can be fought at, lowest first, which is what a party config picks from. Sent
    // rather than held client side because it is catalog data, and a second copy in the frontend
    // would be the one that misses the next boss.
    val difficulties: List<String> = emptyList(),
    // What one clear puts in one inventory, per mode and world. See V79__piece_sync.sql.
    @AbsentOnCachedPayload
    val pieces: List<BossPieceResponse> = emptyList(),
)

@Serializable
data class BossPieceResponse(
    val difficulty: String,
    val world: String,
    val tokenName: String,
    val iconUrl: String?,
    val quantity: Int,
    val stackSize: Int,
    // One pile for the whole party, divided by the config's piece ratio.
    val pooled: Boolean,
)

@Serializable
data class BossClearResponse(
    val bossKey: String,
    val cleared: Boolean,
    // The period this row is an answer for, so the client never has to recompute a reset boundary
    // to know what it is looking at. ISO date.
    val periodStart: String,
    val capturedAt: String,
)

/**
 * One cell of the matrix, answered by hand instead of by a planner capture.
 *
 * No period in the payload. Which period a tick lands in follows from the boss's own cadence, and
 * that boundary has one implementation (BossPeriod.kt); letting a client name it would be a second.
 */
@Serializable
data class SetBossClearRequest(
    val characterId: String,
    val bossKey: String,
    val cleared: Boolean,
)

/**
 * Which bosses a character does not run, as the whole set.
 *
 * No period, unlike SetBossClearRequest. "Only my main runs Jupiter" is a fact about the character,
 * not about this week, so it outlives the reset that wipes the clears.
 *
 * The bosses NOT run rather than the ones that are, though the editor is a list of the ones that
 * are. A boss added to the catalog between the page loading and the save would otherwise arrive as
 * one nobody runs, which is a claim the user never made.
 */
@Serializable
data class SetBossRoutineRequest(
    val characterId: String,
    val skippedBossKeys: List<String> = emptyList(),
)

/**
 * One view of the matrix: either the current period or one past week.
 *
 * The navigation is served rather than computed client side for the reason the period label already
 * was: the reset boundary has one implementation (BossPeriod.kt), and "the week before this one" is
 * that same boundary asked backwards. A frontend doing its own date arithmetic would be a second
 * copy of the number this feature cannot get wrong.
 */
@Serializable
data class BossClearsViewResponse(
    val clearsByCharacter: Map<String, List<BossClearResponse>>,
    // character id -> the boss keys that character does not run. On a past week these are the marks
    // that had been SAID by the end of it, not the ones standing now, so an old week is measured
    // against the routine it was actually run under. See bossSkipsFor's asOf.
    val skipsByCharacter: Map<String, List<String>> = emptyMap(),
    // Null for the current view, which spans three cadences and so has no single period. Set to the
    // week being shown when the user has stepped back.
    val weekStart: String?,
    // Null at either end: no stored history before it, or nowhere newer to go than now.
    val previousWeekStart: String?,
    val nextWeekStart: String?,
    // The week now in progress. The client compares nextWeekStart against it to know that stepping
    // forward once more lands on the live view (all three cadences) rather than on a history slice
    // of the current week, which would quietly drop the daily and monthly rows.
    val currentWeekStart: String,
    // Cadence -> ISO instant of the next rollover, for the countdown. Always about *now*, even when
    // the matrix is showing an old week.
    val nextResets: Map<String, String>,
    // The server's clock at the moment it answered. The countdown ticks against this rather than
    // the browser's own clock, so a skewed machine does not show a confidently wrong time to reset.
    val now: String,
)
