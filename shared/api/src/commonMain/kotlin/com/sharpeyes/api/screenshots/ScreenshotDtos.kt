package com.sharpeyes.api.screenshots

import kotlinx.serialization.Serializable

@Serializable
data class UploadScreenshotRequest(
    val imageBase64: String,
    val mediaType: String,
    val characterId: String? = null,
)

@Serializable
data class ResolveScreenshotRequest(
    val characterId: String,
)

enum class ScreenshotOutcome {
    MATCHED,
    MISMATCH,
    NEW_CHARACTER_DETECTED,
    UNRESOLVABLE,
    UNRECOGNIZED_SCREENSHOT,
    FAILED,
}

@Serializable
data class ScreenshotResultResponse(
    val screenshotId: String,
    val outcome: ScreenshotOutcome,
    val detectedCharacterName: String? = null,
    val detectedLevel: Int? = null,
    val pinnedCharacterName: String? = null,
    val failureReason: String? = null,
    // What we actually read off the image. Sent back on EVERY outcome, not just
    // the successful one, a screenshot that needs review has still been parsed,
    // and showing the user "we read these 6 tokens, just tell us whose they are"
    // is the difference between a one-click confirmation and a blank row that
    // looks like nothing happened. (It looked like nothing happened, because the
    // response dropped them.)
    val tokenCounts: List<DetectedItemResponse> = emptyList(),
    // Same rule as tokenCounts: what we read, on every outcome. One capture can hold the inventory
    // and the Maple Planner at once, so these are additional to the tokens above, not instead of.
    val bossClears: List<DetectedBossClearResponse> = emptyList(),
    // Rows the reader found and could not name, and whether the capture reached the bottom of the
    // boss list. Both are reasons to re-capture rather than to trust what came back, and both are
    // invisible unless the response says so: a truncated list looks exactly like a short one, and
    // a dropped row looks exactly like a boss that was not cleared.
    val unreadableBossRows: Int? = null,
    val reachedBossListEnd: Boolean? = null,
)

@Serializable
data class DetectedBossClearResponse(
    // The catalog key, e.g. "chosen-seren".
    val bossKey: String,
    // Resolved server-side from boss_catalog, for the reason DetectedItemResponse carries a
    // displayName: the prose name is not derivable from the key.
    val displayName: String,
    val cleared: Boolean,
)

@Serializable
data class DetectedItemResponse(
    // The parser's key (token_catalog.vision_key), e.g. "kalos-token".
    val tokenName: String,
    // The human name, e.g. "Kalos's Residual Determination". The two are not
    // derivable from each other, that assumption is exactly what silently broke
    // token persistence, so the server resolves it from the catalog and sends
    // both rather than letting the client guess.
    val displayName: String,
    // The catalog row's id, so the preview can line a parsed count up against what is already
    // stored and show the DIFFERENCE. Matching on displayName instead would work until two items
    // shared a name, and would fail silently when they did.
    val tokenCatalogId: String?,
    // Which section of the inventory this belongs in. See TokenCatalog.itemGroup.
    val itemGroup: String?,
    val iconUrl: String?,
    val quantity: Int,
)
