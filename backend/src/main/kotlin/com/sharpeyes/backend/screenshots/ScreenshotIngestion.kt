package com.sharpeyes.backend.screenshots

import com.sharpeyes.backend.bosses.upsertBossClears
import com.sharpeyes.backend.characters.CharacterResponse
import com.sharpeyes.backend.characters.findOwnedCharacter
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.services.DetectedBossClear
import com.sharpeyes.backend.services.DetectedToken
import com.sharpeyes.backend.services.ScreenshotParseOutcome
import com.sharpeyes.backend.services.ScreenshotParseResult
import com.sharpeyes.backend.services.ScreenshotParser
import com.sharpeyes.backend.services.ScreenshotType
import com.sharpeyes.backend.users.ensureUser
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

private data class OutcomeDecision(
    val outcome: ScreenshotOutcome,
    val parseStatus: String,
    val characterId: Uuid?,
)

// Ownership of `pinnedCharacterId` (if present) must already be verified by
// the caller. See ScreenshotRoutes.kt's pre-check, so this never has to
// distinguish "not owned" from "not pinned."
suspend fun ingestScreenshot(
    userId: String,
    email: String,
    request: UploadScreenshotRequest,
    pinnedCharacterId: Uuid?,
    screenshotParser: ScreenshotParser,
): ScreenshotResultResponse {
    val imageBytes =
        java.util.Base64
            .getDecoder()
            .decode(request.imageBase64)
    val parseOutcome = screenshotParser.parseScreenshot(imageBytes, request.mediaType)

    return dbQuery {
        ensureUser(userId, email)
        when (parseOutcome) {
            is ScreenshotParseOutcome.Failed -> insertFailedScreenshot(userId, pinnedCharacterId, parseOutcome.reason)
            is ScreenshotParseOutcome.Parsed -> insertParsedScreenshot(userId, pinnedCharacterId, parseOutcome)
        }
    }
}

private fun insertFailedScreenshot(
    userId: String,
    pinnedCharacterId: Uuid?,
    reason: String,
): ScreenshotResultResponse {
    val screenshotId = Uuid.random()
    Screenshots.insert {
        it[id] = screenshotId
        it[Screenshots.userId] = userId
        it[characterId] = pinnedCharacterId
        it[type] = null
        it[uploadedAt] = Clock.System.now()
        it[parseStatus] = "FAILED"
    }
    return ScreenshotResultResponse(screenshotId.toString(), ScreenshotOutcome.FAILED, failureReason = reason)
}

private fun insertParsedScreenshot(
    userId: String,
    pinnedCharacterId: Uuid?,
    parsed: ScreenshotParseOutcome.Parsed,
): ScreenshotResultResponse {
    val result = parsed.result
    val pinnedCharacter = pinnedCharacterId?.let { findOwnedCharacter(it, userId) }
    val decision = decideOutcome(userId, pinnedCharacterId, pinnedCharacter, result)

    val screenshotId = Uuid.random()
    val now = Clock.System.now()
    Screenshots.insert {
        it[id] = screenshotId
        it[Screenshots.userId] = userId
        it[characterId] = decision.characterId
        it[type] = result.screenshotType.name
        it[uploadedAt] = now
        it[parseStatus] = decision.parseStatus
        it[rawParseResult] = Json.encodeToJsonElement(result)
        it[detectedCharacterName] = result.characterHud?.name
        it[detectedLevel] = result.characterHud?.level
    }

    if (decision.outcome == ScreenshotOutcome.MATCHED) {
        upsertTokenCounts(
            decision.characterId!!,
            result.tokenCounts.orEmpty(),
            screenshotId,
            now,
            inventoryComplete = result.inventoryComplete == true,
        )
        upsertBossClears(decision.characterId, result.bossClears.orEmpty(), screenshotId, now)
    }

    return ScreenshotResultResponse(
        screenshotId = screenshotId.toString(),
        outcome = decision.outcome,
        detectedCharacterName = result.characterHud?.name,
        detectedLevel = result.characterHud?.level,
        pinnedCharacterName = pinnedCharacter?.name,
        tokenCounts = describeTokens(result.tokenCounts.orEmpty()),
        bossClears = describeBossClears(result.bossClears.orEmpty()),
        unreadableBossRows = result.unreadableBossRows,
        reachedBossListEnd = result.reachedListEnd,
    )
}

// A HUD and a pin are both attribution sources, and the pin is the stronger one:
// the HUD is something we inferred from pixels, the pin is a human telling us the
// answer outright. So a pin attributes on its own, and the HUD's job is to
// contradict it when the two disagree.
//
// This used to read "a pin is only ever a cross-check target, never a blind
// attribution source: no HUD -> always NEEDS_REVIEW, even with a pin." That rule
// came from the vision-model era, when the parser could hallucinate a name and the
// pin existed purely to catch it doing so. It inverted the trust: an upload with a
// pin and no HUD was rejected not because we doubted it, but because we had no
// second opinion to confirm it, so we asked the user to pick a character they had
// already picked, on a screenshot we had already read perfectly. The upload page
// tells people a cropped inventory is fine; this made a liar of it.
//
// The MISMATCH branch below is the case that rule was really protecting, and it is
// untouched: if a HUD IS present and disagrees with the pin, we still refuse to
// guess.
private fun decideOutcome(
    userId: String,
    pinnedCharacterId: Uuid?,
    pinnedCharacter: CharacterResponse?,
    result: ScreenshotParseResult,
): OutcomeDecision =
    when {
        // No inventory in frame means no counts to attribute, so a pin buys nothing.
        result.screenshotType == ScreenshotType.UNRECOGNIZED ->
            OutcomeDecision(ScreenshotOutcome.UNRECOGNIZED_SCREENSHOT, "NEEDS_REVIEW", pinnedCharacterId)

        pinnedCharacterId != null ->
            when {
                // Pinned to a character we cannot resolve (deleted, or not this user's).
                // Never fall through to auto-attribution here: the HUD could name some
                // OTHER character and we would silently save to them instead of the one
                // the user asked for.
                pinnedCharacter == null ->
                    OutcomeDecision(ScreenshotOutcome.UNRESOLVABLE, "NEEDS_REVIEW", null)

                // Nothing in the image to contradict the pin: take the user at their word.
                result.characterHud == null ->
                    OutcomeDecision(ScreenshotOutcome.MATCHED, "SUCCESS", pinnedCharacterId)

                pinnedCharacter.name.equals(result.characterHud.name, ignoreCase = true) ->
                    OutcomeDecision(ScreenshotOutcome.MATCHED, "SUCCESS", pinnedCharacterId)

                else ->
                    OutcomeDecision(ScreenshotOutcome.MISMATCH, "NEEDS_REVIEW", pinnedCharacterId)
            }

        // Unpinned, and no name in the image: there is genuinely no way to know whose
        // this is, so ask.
        result.characterHud == null ->
            OutcomeDecision(ScreenshotOutcome.UNRESOLVABLE, "NEEDS_REVIEW", pinnedCharacterId)

        else ->
            findCharacterIdByName(userId, result.characterHud.name)
                ?.let { OutcomeDecision(ScreenshotOutcome.MATCHED, "SUCCESS", it) }
                ?: OutcomeDecision(ScreenshotOutcome.NEW_CHARACTER_DETECTED, "NEEDS_REVIEW", null)
    }

private fun findCharacterIdByName(
    userId: String,
    name: String,
): Uuid? =
    Characters
        .selectAll()
        .where { (Characters.userId eq userId) and (Characters.name.lowerCase() eq name.lowercase()) }
        .singleOrNull()
        ?.get(Characters.id)

// Resolves the parser's keys to what a human should see. Done server-side, from
// the catalog, because the display name is not derivable from the key.
private fun describeTokens(tokens: List<DetectedToken>): List<DetectedTokenResponse> {
    val catalog = TokenCatalog.selectAll().associateBy { it[TokenCatalog.visionKey] }
    return tokens.map { token ->
        val row = catalog[token.tokenName]
        DetectedTokenResponse(
            tokenName = token.tokenName,
            displayName = row?.get(TokenCatalog.name) ?: token.tokenName,
            tokenCatalogId = row?.get(TokenCatalog.id)?.toString(),
            itemGroup = row?.get(TokenCatalog.itemGroup),
            iconUrl = row?.get(TokenCatalog.iconRefKey)?.let { "/token-icons/$it" },
            quantity = token.quantity,
        )
    }
}

// As describeTokens, and for the same reason: the key is what the reader emits, the prose name is
// what a human reads, and neither is derivable from the other.
private fun describeBossClears(clears: List<DetectedBossClear>): List<DetectedBossClearResponse> {
    if (clears.isEmpty()) return emptyList()
    val catalog = BossCatalog.selectAll().associateBy { it[BossCatalog.bossKey] }
    return clears.map { clear ->
        DetectedBossClearResponse(
            bossKey = clear.bossKey,
            displayName = catalog[clear.bossKey]?.get(BossCatalog.name) ?: clear.bossKey,
            cleared = clear.cleared,
        )
    }
}

// `inventoryComplete` is what licenses the delete below, and it is deliberately narrow: the
// parser only sets it when all 128 slots were in frame, none obscured, and every count read.
// Absent that, an item missing from `tokens` might merely have been off-screen or covered, and
// deleting it would destroy a real stack. This is why the flag is not simply "did we parse ok".
private fun upsertTokenCounts(
    characterId: Uuid,
    tokens: List<DetectedToken>,
    screenshotId: Uuid,
    capturedAt: Instant,
    inventoryComplete: Boolean,
) {
    val catalogIdsByVisionKey =
        TokenCatalog.selectAll().associate {
            it[TokenCatalog.visionKey] to it[TokenCatalog.id]
        }

    if (inventoryComplete) {
        // The player spent the stack. A row kept here outlives the item and reads as a
        // confident wrong number: mechyfechy showed 50 Kaling pieces held for 37 minutes after
        // a capture that plainly had none, because nothing could ever clear it.
        //
        // Deleted rather than zeroed, because "no row" is already how an item the player has
        // never held behaves. The read path inner-joins the catalog (CharacterTokenRoutes.kt),
        // so a zero row would instead render a literal 0 in the grid.
        val seen = tokens.mapNotNull { catalogIdsByVisionKey[it.tokenName] }.toSet()
        // Selected then deleted by an explicit inList, rather than one notInList against `seen`,
        // because `seen` is empty for a complete capture of an empty inventory and an empty
        // notInList is exactly the kind of silent all-or-nothing this must not be guessing at.
        val stale =
            CharacterTokenCount
                .selectAll()
                .where { CharacterTokenCount.characterId eq characterId }
                .map { it[CharacterTokenCount.tokenCatalogId] }
                .filterNot { it in seen }
        if (stale.isNotEmpty()) {
            CharacterTokenCount.deleteWhere {
                (CharacterTokenCount.characterId eq characterId) and
                    (CharacterTokenCount.tokenCatalogId inList stale)
            }
        }
    }

    for (token in tokens) {
        // The parser can only ever emit a key it has a template for, so an
        // unmatched one means the catalog and the templates have drifted apart.
        // That is a bug, and it must be loud: this lookup used to fall back to
        // `continue`, which silently dropped EVERY token when the parser switched
        // from display names to slugs, and no test noticed.
        val catalogId =
            catalogIdsByVisionKey[token.tokenName]
                ?: error(
                    "No token_catalog row with vision_key='${token.tokenName}'. The parser's " +
                        "templates and the catalog have drifted. See V4__token_catalog_vision_key.sql.",
                )
        CharacterTokenCount.upsert(CharacterTokenCount.characterId, CharacterTokenCount.tokenCatalogId) { row ->
            row[CharacterTokenCount.characterId] = characterId
            row[CharacterTokenCount.tokenCatalogId] = catalogId
            row[quantity] = token.quantity
            row[CharacterTokenCount.capturedAt] = capturedAt
            row[sourceScreenshotId] = screenshotId
        }
    }
}

// Powers all three of PLAN.md's "new character detected" actions (confirm-add
// = create the character via the existing M2 endpoint, then call this; pick-
// existing = call this directly) plus mismatch's one-click fix and
// unresolvable's manual picker. None of them need the image again, since
// the parsed result was already persisted to `rawParseResult`.
suspend fun resolveScreenshot(
    userId: String,
    screenshotId: Uuid,
    newCharacterId: Uuid,
): Boolean =
    dbQuery {
        val row =
            Screenshots
                .selectAll()
                .where { (Screenshots.id eq screenshotId) and (Screenshots.userId eq userId) }
                .singleOrNull() ?: return@dbQuery false
        if (row[Screenshots.parseStatus] != "NEEDS_REVIEW") return@dbQuery false
        val rawResponse = row[Screenshots.rawParseResult] ?: return@dbQuery false
        val parsed = Json.decodeFromJsonElement<ScreenshotParseResult>(rawResponse)
        // Either payload alone is a real result to file: a planner-only capture has no
        // tokenCounts, and an inventory with no planner in frame has no bossClears. Testing
        // tokenCounts alone (as this did) would refuse to resolve every planner capture, which is
        // the one kind of upload most likely to need review, since a planner has no grid to
        // attribute from.
        if (parsed.tokenCounts == null && parsed.bossClears == null) return@dbQuery false
        findOwnedCharacter(newCharacterId, userId) ?: return@dbQuery false

        val capturedAt = Clock.System.now()
        upsertTokenCounts(
            newCharacterId,
            parsed.tokenCounts.orEmpty(),
            screenshotId,
            capturedAt,
            inventoryComplete = parsed.inventoryComplete == true,
        )
        upsertBossClears(newCharacterId, parsed.bossClears.orEmpty(), screenshotId, capturedAt)
        Screenshots.update({ Screenshots.id eq screenshotId }) {
            it[characterId] = newCharacterId
            it[parseStatus] = "SUCCESS"
        }
        true
    }

suspend fun ignoreScreenshot(
    userId: String,
    screenshotId: Uuid,
): Boolean =
    dbQuery {
        Screenshots.update({ (Screenshots.id eq screenshotId) and (Screenshots.userId eq userId) }) {
            it[parseStatus] = "IGNORED"
        } > 0
    }
