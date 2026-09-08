package com.sharpeyes.backend.characters

import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.tokens.isBossToken
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Typing a count in, which until now nothing could do: the only writer of character_token_count was
// a screenshot parse (ScreenshotIngestion.upsertTokenCounts).
//
// The count is ABSOLUTE, exactly as a parse's was. "What do you hold" is a question with one answer
// and re-typing it corrects a mistake completely, where a running total built from adjustments is a
// number nobody has ever checked against the game. A "+2 after a run" button is still the ordinary
// way to use this; it reads the figure on screen, adds to it, and sends the result, so what is
// stored is always the number the person was looking at.
//
// Nothing marks these rows as hand-typed, because the schema already says so: a parse writes
// source_screenshot_id, and this leaves it null. See V1__create_core_schema.sql.

/** The most anybody can hold of one item, well past a real stack and short of an overflow. */
private const val MAX_QUANTITY = 1_000_000

internal suspend fun RoutingContext.setCharacterTokenCount() {
    val (userId, email) = call.principalIdAndEmail()
    // Both together: an unreadable id of either kind is the same answer, and parseUuidParam has
    // already answered the call by the time it hands back null.
    val characterId = call.parseUuidParam("id")
    val tokenId = call.parseUuidParam("tokenId")
    if (characterId == null || tokenId == null) return
    val request = call.receive<SetTokenCountRequest>()

    if (request.quantity < 0 || request.quantity > MAX_QUANTITY) {
        call.respond(HttpStatusCode.BadRequest, "quantity must be between 0 and $MAX_QUANTITY")
        return
    }

    val written =
        dbQuery {
            ensureUser(userId, email)
            // Ownership first, and a 404 rather than a 403: a character that is not yours must not
            // be distinguishable from one that does not exist.
            if (findOwnedCharacter(characterId, userId) == null) return@dbQuery false
            if (!isAddableToken(tokenId)) return@dbQuery false
            writeTokenCount(characterId, tokenId, request.quantity)
            true
        }

    call.respond(if (written) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
}

/**
 * Whether a count may be written for this item at all.
 *
 * A boss token specifically, not merely an item that exists. The + cannot offer anything else, so
 * this only fires on a hand-made request, and refusing it keeps the API saying the same thing the
 * screen does about which items there are. A screenshot parse writes through
 * ScreenshotIngestion.upsertTokenCounts and does NOT pass here, so what a capture reads is still
 * stored whether or not the inventory shows it.
 *
 * Must run inside a transaction.
 */
internal fun isAddableToken(tokenId: Uuid): Boolean =
    TokenCatalog
        .selectAll()
        .where { (TokenCatalog.id eq tokenId) and isBossToken() }
        .empty()
        .not()

/**
 * Sets what one character holds of one item, or clears it.
 *
 * Zero DELETES the row rather than storing a zero, which is the same thing a complete capture does
 * with an item it no longer sees. No row is already how an item nobody has ever held behaves, and
 * the read path inner-joins the catalog, so a zero row would render a literal 0 in the grid instead
 * of the item being absent. See upsertTokenCounts.
 *
 * Must run inside a transaction.
 */
internal fun writeTokenCount(
    characterId: Uuid,
    tokenId: Uuid,
    quantity: Int,
) {
    if (quantity == 0) {
        CharacterTokenCount.deleteWhere {
            (CharacterTokenCount.characterId eq characterId) and
                (CharacterTokenCount.tokenCatalogId eq tokenId)
        }
        return
    }
    CharacterTokenCount.upsert(CharacterTokenCount.characterId, CharacterTokenCount.tokenCatalogId) {
        it[CharacterTokenCount.characterId] = characterId
        it[CharacterTokenCount.tokenCatalogId] = tokenId
        it[CharacterTokenCount.quantity] = quantity
        // When it was said, not when it was seen. It is the same column a parse fills, and it is
        // read as "how current is this figure", which a typed one answers just as well.
        it[CharacterTokenCount.capturedAt] = Clock.System.now()
        // Null is what says nobody photographed this. Left explicit rather than defaulted, because
        // an upsert over a row a parse wrote must CLEAR the screenshot it came from.
        it[CharacterTokenCount.sourceScreenshotId] = null
    }
}
