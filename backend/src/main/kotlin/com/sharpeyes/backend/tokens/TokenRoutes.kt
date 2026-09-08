package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.RedemptionRule
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.inActiveWorld
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.countDistinct
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.sum
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll

fun Route.tokenRoutes() {
    get { getTokenTotals() }
    // Registered BEFORE any parameter route would be, and needed because the totals above only
    // carry what somebody already HOLDS. Typing a count for an item you hold none of needs the list
    // of items that exist, which nothing else served.
    get("/catalog") { getTokenCatalog() }
}

/**
 * Every BOSS TOKEN the catalog knows, whether or not anybody holds one.
 *
 * The inventory reads what you hold; this reads what there IS to hold. Not merged into the totals,
 * because a total of zero and an item nobody has ever picked up are the same row here and very
 * different claims on the screen that counts them.
 */
private suspend fun RoutingContext.getTokenCatalog() {
    val (userId, email) = call.principalIdAndEmail()
    val items =
        dbQuery {
            ensureUser(userId, email)
            bossTokenCatalog()
        }
    call.respond(items)
}

/**
 * The items the + can offer, which is the boss tokens and only those.
 *
 * Must be called inside a transaction. Internal rather than private for the reason tokenTotalsFor
 * is: the thing worth testing is that this list agrees with what the seed calls a boss token, and a
 * test that re-typed the query would agree with itself instead. Renaming the group in
 * catalog/items.yaml empties the inventory with nothing else to say so.
 */
internal fun bossTokenCatalog(): List<TokenCatalogResponse> =
    TokenCatalog
        .join(
            RedemptionRule,
            JoinType.LEFT,
            onColumn = TokenCatalog.id,
            otherColumn = RedemptionRule.itemId,
        ).selectAll()
        .where { isBossToken() }
        .orderBy(TokenCatalog.sortOrder)
        .map {
            TokenCatalogResponse(
                tokenCatalogId = it[TokenCatalog.id].toString(),
                name = it[TokenCatalog.name],
                iconUrl = it[TokenCatalog.iconRefKey]?.let { file -> "/token-icons/$file" },
                itemGroup = it[TokenCatalog.itemGroup],
                sourceBoss = it[TokenCatalog.sourceBossName],
                redeemThreshold = it[RedemptionRule.redeemThreshold],
                redeemSlots = it.getOrNull(RedemptionRule.slotGroup) ?: emptyList(),
            )
        }

/**
 * One item, with no count attached.
 *
 * Deliberately NOT CharacterTokenResponse with a zero: that one carries a quantity and a capturedAt,
 * and inventing both to describe an item nobody holds is two figures nobody said.
 */
@Serializable
data class TokenCatalogResponse(
    val tokenCatalogId: String,
    val name: String,
    val iconUrl: String?,
    val itemGroup: String?,
    val sourceBoss: String?,
    val redeemThreshold: Int?,
    val redeemSlots: List<String> = emptyList(),
)

private suspend fun RoutingContext.getTokenTotals() {
    val (userId, email) = call.principalIdAndEmail()
    val totals =
        dbQuery {
            ensureUser(userId, email)
            tokenTotalsFor(userId)
        }
    call.respond(totals)
}

// The aggregate the dashboard shows: every boss token this user holds, summed across
// all their characters. Doing this server-side rather than fetching each
// character's tokens and adding them up in the browser keeps it one query
// instead of one-per-character, and keeps the ownership filter in one place.
//
// Must be called inside a transaction. Internal rather than private so
// TokenTotalsTest can exercise this exact query, the ownership scoping and the
// GROUP BY are the two things most likely to be quietly wrong, and a test that
// re-typed the query would prove nothing about the one that actually runs.
internal fun tokenTotalsFor(userId: String): List<TokenTotalResponse> {
    val totalQuantity = CharacterTokenCount.quantity.sum()
    val contributors = CharacterTokenCount.characterId.countDistinct()

    return CharacterTokenCount
        .innerJoin(TokenCatalog)
        .innerJoin(Characters)
        // LEFT join. Every boss token currently HAS a redemption rule, so an inner join would
        // pass today and silently drop the first one added without one.
        .join(RedemptionRule, JoinType.LEFT, onColumn = TokenCatalog.id, otherColumn = RedemptionRule.itemId)
        .select(
            TokenCatalog.id,
            TokenCatalog.name,
            TokenCatalog.iconRefKey,
            TokenCatalog.itemGroup,
            TokenCatalog.sortOrder,
            RedemptionRule.redeemThreshold,
            totalQuantity,
            contributors,
        )
        // Scope to this user's characters, in the world being shown. The join reaches every user's
        // character rows otherwise, so dropping the first leaks other people's counts into the
        // totals; dropping the second pools two worlds' inventories, which cannot be redeemed
        // against each other. Both silently, and both as a plausible-looking larger number.
        .where { (Characters.userId eq userId) and inActiveWorld(userId) and isBossToken() }
        .groupBy(
            TokenCatalog.id,
            TokenCatalog.name,
            TokenCatalog.iconRefKey,
            TokenCatalog.itemGroup,
            TokenCatalog.sortOrder,
            RedemptionRule.redeemThreshold,
        ).orderBy(TokenCatalog.sortOrder)
        .map { row ->
            TokenTotalResponse(
                tokenCatalogId = row[TokenCatalog.id].toString(),
                name = row[TokenCatalog.name],
                iconUrl = row[TokenCatalog.iconRefKey]?.let { "/token-icons/$it" },
                quantity = row[totalQuantity] ?: 0,
                itemGroup = row[TokenCatalog.itemGroup],
                redeemThreshold = row[RedemptionRule.redeemThreshold],
                characterCount = row[contributors].toInt(),
            )
        }
}
