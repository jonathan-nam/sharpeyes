package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SaveSharesRequest
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The standing split alone, written by anybody in the party. It is a deal between the seats; this
// touches nothing else of the config.

/** Why [shares] cannot be the split of a party whose standing seats take [standing], or null. */
internal fun splitRefusal(
    standing: Map<Uuid, Int>,
    shares: Map<Uuid, Int>,
): String? =
    when {
        shares.keys.any { it !in standing } -> "shares may only name somebody in this party"
        shares.values.any { it < 0 || it > MAX_SHARES } -> "a share count must be between 0 and $MAX_SHARES"
        standing.keys.sumOf { shares[it] ?: standing.getValue(it) } < 1 -> "somebody in the party has to take a share"
        else -> null
    }

/**
 * Sets the shares of [partyId]'s seats this week, pinning the weeks already written first. See
 * pinWeeksAlreadyWritten.
 *
 * Seated this week, not standing: a one-off's guests are written onto the night only (see
 * writeNightRoster), and the split on screen names them.
 */
internal fun saveSplit(
    partyId: Uuid,
    shares: Map<Uuid, Int>,
    now: Instant,
): String? {
    val seats =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId eq partyId) and seatedFor(weekOf(todayIn(now))) }
            .associate { it[PartyMember.id] to (it[PartyMember.name] to it[PartyMember.shares]) }
    val standing = seats.mapValues { (_, seat) -> seat.second }
    splitRefusal(standing, shares)?.let { return it }

    val wanted = seats.entries.associate { (id, seat) -> seat.first.lowercase() to (shares[id] ?: seat.second) }
    pinWeeksAlreadyWritten(partyId, wanted, now)
    shares.forEach { (seatId, count) ->
        PartyMember.update({ PartyMember.id eq seatId }) { it[PartyMember.shares] = count }
    }
    Party.update({ Party.id eq partyId }) { it[updatedAt] = now }
    return null
}

/** PUT /api/parties/{id}/shares. The owner or any joined member; 404 for anybody else. */
internal suspend fun RoutingContext.saveSplitRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SaveSharesRequest>()
    val shares = request.shares.mapKeys { Uuid.parseOrNull(it.key) }
    val outcome =
        dbQuery {
            ensureUser(userId, email)
            when {
                !canEditParty(partyId, userId) -> null
                shares.keys.any { it == null } -> "malformed memberId"
                else ->
                    saveSplit(partyId, shares.mapKeys { it.key!! }, Clock.System.now())
                        ?: findParty(partyId, userId)
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
}
