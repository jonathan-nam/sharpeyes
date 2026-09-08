package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Logging a drop without naming a pool: POST /api/parties/loot, registered by PartyRoutes.kt.
//
// Not in LootRoutes.kt with the rest, because every handler there starts by proving a party id in
// the path is the caller's, and this one has no party id: it proves the CHARACTER is theirs and
// works the pool out from there. See logDropRoute.

/**
 * Logs a drop by character and boss, on a run with nobody else.
 *
 * The Drop Log's own form, and the only way to log a drop on a boss that has no party: that
 * character's config for the boss takes it if there is one, and a solo config is opened if there is
 * not. Registered under /api/parties rather than /api/parties/{id}/loot because the pool is what it
 * resolves, so there is no id to be under.
 *
 * The form offers EVERY boss, so a partied one arrives here routinely, and its drop still lands in
 * that party's pool: one config per character per boss, no second pool to open.
 *
 * It does NOT land in that party's SPLIT. This form names nobody, so what it records is a run with
 * nobody else, and the row says so (see V72__loot_solo.sql). Which pool a drop sits in cannot say
 * who was there, and reading it that way handed half of a 3.5b solo kill to somebody who was not in
 * the game. A drop the party shared is added on the party, where the party is named.
 */
internal suspend fun RoutingContext.logDropRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<LogDropRequest>()
    val droppedOn = parseDroppedOn(request.droppedOn) ?: return
    val customName = request.customName?.trim()?.ifBlank { null }
    val characterId = Uuid.parseOrNull(request.characterId)

    val outcome =
        dbQuery {
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
                quantityRefusal(request.quantity) != null -> quantityRefusal(request.quantity)
                else -> {
                    val existing = partyIdFor(characterId, bossId)
                    // A character clears a boss once a period, so opening a solo pool for one it
                    // already has a seat on elsewhere would record a run that cannot have happened.
                    // Only asked when there is no pool yet: an existing config is where the drop
                    // goes whatever else names this character.
                    val clash =
                        if (existing != null) {
                            null
                        } else {
                            validateBossRoster(
                                userId,
                                bossId,
                                exclude = null,
                                rosterOf(characterId, emptyList()),
                                now,
                                // A solo pool is a config that stays, not a night. See createSoloParty.
                                oneOff = false,
                            )
                        }
                    if (clash != null) {
                        clash
                    } else {
                        val partyId = poolFor(userId, characterId, bossId, now)
                        val lootId =
                            addLoot(
                                partyId,
                                LootedDrop(dropId, customName, request.quantity),
                                bossId,
                                droppedOn,
                                now,
                                LootSource(solo = true),
                            )
                        findLoot(lootId, partyId)!!
                    }
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.Created)
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
