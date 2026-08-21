package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Logging a drop without naming a pool: POST /api/parties/loot, registered by PartyRoutes.kt.
//
// Not in LootRoutes.kt with the rest, because every handler there starts by proving a party id in
// the path is the caller's, and this one has no party id: it proves the CHARACTER is theirs and
// works the pool out from there. See logDropRoute.

/**
 * Logs a drop by character and boss, working out which pool it belongs in.
 *
 * The Drop Log's own form, and the only way to log a drop on a boss that has no party: that
 * character's config for the boss takes it if there is one, and a solo config is opened if there is
 * not. Registered under /api/parties rather than /api/parties/{id}/loot because the pool is what it
 * resolves, so there is no id to be under.
 *
 * The form offers EVERY boss, so a partied one arrives here routinely rather than exceptionally. It
 * lands in that party's pool, because there is one config per character per boss and no second pool
 * to open. Which is what made the form's old filter safe to drop: the resolution was always here.
 */
internal suspend fun RoutingContext.logDropRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<LogDropRequest>()
    val droppedOn = parseDroppedOn(request.droppedOn) ?: return
    val customName = request.customName?.trim()?.ifBlank { null }
    val characterId = Uuid.parseOrNull(request.characterId)

    val outcome =
        transaction {
            ensureUser(userId, email)
            val dropId = request.dropKey?.let { dropIdForKey(it) }
            val bossId = bossIdForKey(request.bossKey)
            val now = Clock.System.now()
            when {
                characterId == null || !ownsCharacter(characterId, userId) ->
                    "characterId must be one of your characters"
                bossId == null -> "unknown bossKey"
                (request.dropKey == null) == (customName == null) ->
                    "send exactly one of dropKey or customName"
                request.dropKey != null && dropId == null -> "unknown dropKey"
                else -> {
                    val existing = partyIdFor(characterId, bossId)
                    // Every refusal that needs the pool resolved, in the order they have to run.
                    // The looter is answered against the pool that ALREADY exists, before poolFor
                    // can open one: see looterRefusalForPool.
                    quantityRefusal(request.quantity)
                        ?: soloClash(userId, characterId, bossId, existing, now)
                        ?: looterRefusalForPool(existing, droppedOn, request.looterMemberId)
                        ?: run {
                            val partyId = poolFor(userId, characterId, bossId, now)
                            val lootId =
                                addLoot(
                                    partyId,
                                    LootedDrop(dropId, customName, request.quantity),
                                    bossId,
                                    droppedOn,
                                    now,
                                )
                            recordLooter(lootId, request.looterMemberId)
                            findLoot(lootId, partyId)!!
                        }
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.Created)
}

/**
 * Why this drop cannot open a solo pool, or null when it can or needs none.
 *
 * A character clears a boss once a period, so opening a solo pool for one it already has a seat on
 * elsewhere would record a run that cannot have happened. Only asked when there is no pool yet: an
 * existing config is where the drop goes whatever else names this character.
 */
private fun soloClash(
    userId: String,
    characterId: Uuid,
    bossId: Uuid,
    existingPartyId: Uuid?,
    now: Instant,
): String? =
    if (existingPartyId != null) {
        null
    } else {
        validateBossRoster(userId, bossId, exclude = null, rosterOf(characterId, emptyList()), now)
    }

/**
 * The day to file a drop under, today when it is not said, or null once a refusal has been sent.
 *
 * A malformed date is refused rather than replaced with today: a drop filed on the wrong day is a
 * row you cannot find again.
 */
internal suspend fun RoutingContext.parseDroppedOn(raw: String?): LocalDate? =
    when (raw) {
        null -> Clock.System.todayIn(TimeZone.UTC)
        else ->
            runCatching { LocalDate.parse(raw.trim()) }.getOrNull()
                ?: run {
                    call.respond(HttpStatusCode.BadRequest, "malformed droppedOn, expected YYYY-MM-DD")
                    null
                }
    }
