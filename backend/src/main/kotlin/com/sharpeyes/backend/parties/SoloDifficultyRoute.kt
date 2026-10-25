package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SetSoloDifficultyRequest
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlin.time.Clock
import kotlin.uuid.Uuid

// One route, in a file of its own, as the drop log's is. See LootLogRoute.kt.

/**
 * Records which mode this character runs a boss at alone, and files what the clear then guarantees.
 *
 * By character and boss rather than by config id, like the Drop Log's own route: the pool may not
 * exist yet, and naming the mode is what opens it.
 *
 * A boss this character has a party ON for has its mode written there too: one difficulty, last
 * writer wins. A retired config and a one-off whose period has passed both claim nothing
 * about now, so each is taken back as a pool: see setSoloDifficulty.
 */
internal suspend fun RoutingContext.setSoloDifficultyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SetSoloDifficultyRequest>()
    val characterId =
        Uuid.parseOrNull(request.characterId)
            ?: return call.respond(HttpStatusCode.BadRequest, "malformed characterId")

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val bossId = bossIdForKey(request.bossKey)
            when {
                // Ownership first, as createPartyRoute does: the pair lookup setSoloDifficulty runs
                // does not filter by user, so somebody else's character must not reach a config
                // through it.
                !ownsCharacter(characterId, userId) -> "characterId must be one of your characters"
                bossId == null -> "unknown bossKey"
                request.difficulty == null && difficultyRequired(bossId) -> "pick a difficulty"
                else ->
                    validateDifficulty(bossId, request.difficulty) ?: run {
                        // Non-null by the catalog row the boss id came out of.
                        val reset = bossResetOf(bossId)!!
                        val partyId =
                            setSoloDifficulty(
                                userId,
                                characterId,
                                bossId,
                                reset,
                                request.difficulty,
                                Clock.System.now(),
                            )
                        findParty(partyId, userId)!!
                    }
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
}
