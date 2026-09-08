package com.sharpeyes.backend.characters

import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.RedemptionRule
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.tokens.isBossToken
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.inActiveWorld
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// What a character HOLDS, kept apart from what a character IS.
//
// Split out of CharacterRoutes.kt when detekt started objecting that the file had too many
// functions, a fair reading of something real. Character CRUD and inventory queries share a URL
// prefix and nothing else; they do not share a reason to change.

// Every character's inventory, in one request.
//
// The page already knows, on load, that you are about to look at one of these characters, it
// just does not know WHICH. Fetching them one at a time on selection means the first visit to
// each character has nothing to draw, so the panel renders empty and then fills: the flicker.
//
// One query rather than one-per-character. The N+1 would work and would be worse in exactly the
// way that matters here: it puts a network round-trip between the click and the pixels, which is
// the thing we are trying to remove.
internal suspend fun RoutingContext.getAllCharacterTokens() {
    val (userId, email) = call.principalIdAndEmail()
    val byCharacter =
        dbQuery {
            ensureUser(userId, email)
            CharacterTokenCount
                .innerJoin(TokenCatalog)
                .innerJoin(Characters)
                .join(
                    RedemptionRule,
                    JoinType.LEFT,
                    onColumn = TokenCatalog.id,
                    otherColumn = RedemptionRule.itemId,
                ).selectAll()
                // Scope to this user's characters, in the world being shown. Without the first the
                // join reaches every user's rows; without the second it returns counts for
                // characters the caller's list does not contain.
                .where { (Characters.userId eq userId) and inActiveWorld(userId) and isBossToken() }
                .orderBy(TokenCatalog.sortOrder)
                .groupBy({ it[CharacterTokenCount.characterId].toString() }) {
                    it.toCharacterTokenResponse()
                }
        }
    call.respond(byCharacter)
}

internal suspend fun RoutingContext.getCharacterTokens() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val tokens =
        dbQuery {
            ensureUser(userId, email)
            // Ownership check first: a character that isn't this user's must 404
            // rather than return an empty token list, which would leak existence.
            if (findOwnedCharacter(characterId, userId) == null) {
                null
            } else {
                characterTokensFor(characterId)
            }
        }

    if (tokens == null) {
        call.respond(HttpStatusCode.NotFound)
    } else {
        call.respond(tokens)
    }
}

/**
 * One character's inventory: the boss tokens they hold, and nothing else.
 *
 * Must be called inside a transaction. Internal so a test can prove the filter against a character
 * that really does hold a symbol, which is the only way to tell "left out" from "never stored".
 */
internal fun characterTokensFor(characterId: Uuid): List<CharacterTokenResponse> =
    CharacterTokenCount
        .innerJoin(TokenCatalog)
        // LEFT join. Every boss token currently HAS a redemption rule, so an inner join would pass
        // today and silently drop the first one added without one.
        .join(
            RedemptionRule,
            JoinType.LEFT,
            onColumn = TokenCatalog.id,
            otherColumn = RedemptionRule.itemId,
        ).selectAll()
        .where { (CharacterTokenCount.characterId eq characterId) and isBossToken() }
        .orderBy(TokenCatalog.sortOrder)
        .map { it.toCharacterTokenResponse() }

private fun ResultRow.toCharacterTokenResponse(): CharacterTokenResponse =
    CharacterTokenResponse(
        tokenCatalogId = this[TokenCatalog.id].toString(),
        name = this[TokenCatalog.name],
        // icon_ref_key is a bare filename; Routing.kt serves the seed-assets
        // dir at /token-icons, and the frontend resolves this against the API
        // base URL (lib/api.ts's apiAssetUrl).
        iconUrl = this[TokenCatalog.iconRefKey]?.let { "/token-icons/$it" },
        quantity = this[CharacterTokenCount.quantity],
        itemGroup = this[TokenCatalog.itemGroup],
        sourceBoss = this[TokenCatalog.sourceBossName],
        redeemThreshold = this[RedemptionRule.redeemThreshold],
        redeemSlots = this.getOrNull(RedemptionRule.slotGroup) ?: emptyList(),
        capturedAt = this[CharacterTokenCount.capturedAt].toString(),
    )
