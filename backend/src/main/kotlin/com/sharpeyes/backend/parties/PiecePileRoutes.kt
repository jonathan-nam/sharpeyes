package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.parseWeekParam
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyPiecePile
import com.sharpeyes.backend.db.PartyPieceTake
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.tokens.PileEdit
import com.sharpeyes.backend.tokens.editPile
import com.sharpeyes.backend.tokens.removePile
import com.sharpeyes.backend.tokens.seatedCharacters
import com.sharpeyes.backend.tokens.syncSeated
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.datetime.LocalDate
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A party's weekly pile of Eternal pieces, read and corrected on Party View. See tokens/PiecePiles.kt.
// Mirrored by the frontend's types/piece-pile.ts field-for-field.

@Serializable
data class PieceTakeResponse(
    val memberId: String,
    val quantity: Int,
)

@Serializable
data class PiecePileResponse(
    val partyId: String,
    val weekStart: String,
    val tokenCatalogId: String,
    val tokenName: String,
    val iconUrl: String?,
    val difficulty: String,
    val total: Int,
    val stackSize: Int,
    val takes: List<PieceTakeResponse>,
)

@Serializable
data class SavePiecePileRequest(
    val weekStart: String,
    val total: Int,
    // Seat id to pieces taken. Every seat sent; one left out took none.
    val takes: Map<String, Int>,
)

/** Every pile on your parties for one week, the current one unless `?week=` says otherwise. */
internal suspend fun RoutingContext.listPiecePilesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val week =
        parseWeekParam(call.request.queryParameters["week"]).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        } ?: periodStartFor(WEEKLY_CADENCE, Clock.System.now())
    val piles =
        dbQuery {
            ensureUser(userId, email)
            piecePilesOf(userId, week)
        }
    call.respond(piles)
}

/** Every pile across the user's parties for one week. Shared with the boot warmup. */
internal fun piecePilesOf(
    userId: String,
    week: LocalDate,
): List<PiecePileResponse> =
    piecePilesFor(Party.selectAll().where { Party.userId eq userId }.map { it[Party.id] }, week)

/** Adds or corrects one week's pile. Answers with the pile as written. */
internal suspend fun RoutingContext.savePiecePileRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SavePiecePileRequest>()
    val week = weekOrNull(request.weekStart)
    val takes = request.takes.mapNotNull { (id, quantity) -> Uuid.parseOrNull(id)?.let { it to quantity } }.toMap()
    if (week == null || takes.size != request.takes.size) {
        return call.respond(HttpStatusCode.BadRequest, "malformed weekStart or seat id")
    }
    val now = Clock.System.now()

    val outcome: Any? =
        dbQuery {
            ensureUser(userId, email)
            if (!ownsParty(partyId, userId)) return@dbQuery null
            val before = seatedCharacters(partyId, week)
            editPile(partyId, week, PileEdit(request.total, takes), now) ?: run {
                afterPileChanged(partyId, week, before + seatedCharacters(partyId, week), now)
                piecePilesFor(listOf(partyId), week).single()
            }
        }
    respondToPile(outcome)
}

/** Takes one week's pile off the party, and its pieces out of every inventory it put them in. */
internal suspend fun RoutingContext.removePiecePileRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val week =
        weekOrNull(call.request.queryParameters["week"])
            ?: return call.respond(HttpStatusCode.BadRequest, "malformed week")
    val now = Clock.System.now()
    val outcome: Any? =
        dbQuery {
            ensureUser(userId, email)
            if (!ownsParty(partyId, userId)) return@dbQuery null
            val before = seatedCharacters(partyId, week)
            removePile(partyId, week)
            afterPileChanged(partyId, week, before, now)
            piecePilesFor(listOf(partyId), week)
        }
    respondToPile(outcome)
}

private suspend fun RoutingContext.respondToPile(outcome: Any?) =
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        else -> call.respond(outcome)
    }

private fun weekOrNull(raw: String?): LocalDate? = raw?.let { parseWeekParam(it).getOrNull() }

/**
 * Every character seated before or after a pile write follows it into their inventory, and so does
 * the config's own character, whose clear adding a pile ticks.
 */
private fun afterPileChanged(
    partyId: Uuid,
    week: LocalDate,
    seated: Set<Uuid>,
    now: Instant,
) {
    val config = Party.selectAll().where { Party.id eq partyId }.first()
    syncSeated(seated + config[Party.characterId], config[Party.bossCatalogId], week, now)
}

internal fun piecePilesFor(
    partyIds: List<Uuid>,
    week: LocalDate,
): List<PiecePileResponse> {
    if (partyIds.isEmpty()) return emptyList()
    val takes =
        PartyPieceTake
            .selectAll()
            .where { (PartyPieceTake.partyId inList partyIds) and (PartyPieceTake.periodStart eq week) }
            .groupBy({ it[PartyPieceTake.partyId] }) {
                PieceTakeResponse(it[PartyPieceTake.memberId].toString(), it[PartyPieceTake.quantity])
            }
    return PartyPiecePile
        .innerJoin(TokenCatalog)
        .selectAll()
        .where { (PartyPiecePile.partyId inList partyIds) and (PartyPiecePile.periodStart eq week) }
        .map {
            val partyId = it[PartyPiecePile.partyId]
            PiecePileResponse(
                partyId = partyId.toString(),
                weekStart = week.toString(),
                tokenCatalogId = it[TokenCatalog.id].toString(),
                tokenName = it[TokenCatalog.name],
                iconUrl = it[TokenCatalog.iconRefKey]?.let { file -> "/token-icons/$file" },
                difficulty = it[PartyPiecePile.difficulty],
                total = it[PartyPiecePile.total],
                stackSize = it[PartyPiecePile.stackSize],
                takes = takes[partyId].orEmpty(),
            )
        }
}
