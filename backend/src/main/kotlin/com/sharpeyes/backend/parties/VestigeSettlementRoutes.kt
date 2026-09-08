package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.VestigeSettlement
import com.sharpeyes.backend.db.VestigeSettlementLoot
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.batchInsert
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Closing the books on a holder's pile: /api/vestige-settlements.
//
// The one thing about the card that cannot be derived. What a holder owes follows from what happened to
// the coupons, and how far through it is follows from the receipts, but neither can say "we are done":
// a drop is queued on `entitled - looted`, which is fixed when the drop is logged and never moves. So a
// pile that was fully accounted for and fully paid had no way off the screen.
//
// It names the DROPS it closes rather than a date, so a drop backfilled from an earlier week afterwards
// is not silently retired, and next week's clears reopen the card on their own. See V52.

/** The most that can be written off in one act. A typo guard, matching the payment ceiling. */
private const val MAX_UNPAID = 1_000_000_000_000L

/** One act of closing a pile, and what it covered. */
@Serializable
data class VestigeSettlementResponse(
    val id: String,
    val holder: VestigeHolder,
    val lootIds: List<String>,
    /** Mesos still owed when the books closed. Zero is a pile that balanced. */
    val unpaid: Long,
    val settledAt: String,
)

@Serializable
data class AddVestigeSettlementRequest(
    val holder: VestigeHolder,
    val lootIds: List<String>,
    val unpaid: Long = 0,
)

fun Route.vestigeSettlementRoutes() {
    get { listSettlements() }
    post { addSettlementRoute() }
    delete("/{settlementId}") { deleteSettlementRoute() }
}

private suspend fun RoutingContext.listSettlements() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        dbQuery {
            ensureUser(userId, email)
            settlementsFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addSettlementRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddVestigeSettlementRequest>()
    val holder = request.holder.normalised()

    val refusal = settlementRefusal(holder, request.lootIds, request.unpaid)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val loot = request.lootIds.mapNotNull { Uuid.parseOrNull(it) }.distinct()
    val result =
        dbQuery {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            if (holder.kind == "PERSON") {
                val theirs =
                    person != null &&
                        Person
                            .selectAll()
                            .where { (Person.id eq person) and (Person.userId eq userId) }
                            .empty()
                            .not()
                if (!theirs) return@dbQuery null
            }

            // Every drop has to be one of yours. Without this a settlement could retire somebody
            // else's row, and the drop would vanish off their ledger rather than off nothing.
            val yours =
                PartyLoot
                    .innerJoin(Party)
                    .select(PartyLoot.id)
                    .where { (PartyLoot.id inList loot) and (Party.userId eq userId) }
                    .map { it[PartyLoot.id] }
                    .toSet()
            if (yours.size != loot.size) return@dbQuery null

            val now = Clock.System.now()
            val settlementId = Uuid.random()
            VestigeSettlement.insert {
                it[id] = settlementId
                it[VestigeSettlement.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[unpaid] = request.unpaid
                it[settledAt] = now
                it[createdAt] = now
            }
            VestigeSettlementLoot.batchInsert(loot) { drop ->
                this[VestigeSettlementLoot.settlementId] = settlementId
                this[VestigeSettlementLoot.lootId] = drop
            }
            settlementsFor(userId)
        }
    if (result == null) {
        call.respond(HttpStatusCode.BadRequest, "that holder or one of those drops is not yours")
    } else {
        call.respond(HttpStatusCode.Created, result)
    }
}

private suspend fun RoutingContext.deleteSettlementRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val settlementId = call.parseUuidParam("settlementId") ?: return
    val rows =
        dbQuery {
            ensureUser(userId, email)
            // The loot rows go with it by cascade, so reopening a pile brings back every drop it
            // closed rather than half of them.
            val gone =
                VestigeSettlement.deleteWhere {
                    (VestigeSettlement.id eq settlementId) and (VestigeSettlement.userId eq userId)
                } > 0
            if (gone) settlementsFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/** Why these books cannot be closed, or null. */
internal fun settlementRefusal(
    holder: VestigeHolder,
    lootIds: List<String>,
    unpaid: Long,
): String? =
    when {
        holder.kind !in setOf("PERSON", "SELF", "CHARACTER") ->
            "holder.kind must be one of PERSON, SELF, CHARACTER"
        (holder.kind == "PERSON") != (holder.personId != null) ->
            "a PERSON holder needs a personId, and nothing else does"
        (holder.kind == "CHARACTER") != (holder.characterName != null) ->
            "a CHARACTER holder needs a characterName, and nothing else does"
        holder.personId != null && runCatching { Uuid.parse(holder.personId) }.isFailure ->
            "personId is not an id"
        // A settlement that names no drop closes nothing, and would sit there looking like it had.
        lootIds.isEmpty() -> "a settlement has to name the drops it closes"
        lootIds.any { Uuid.parseOrNull(it) == null } -> "malformed lootId"
        unpaid < 0 || unpaid > MAX_UNPAID -> "unpaid must be between 0 and $MAX_UNPAID"
        else -> null
    }

/**
 * Every settlement this account has recorded, newest first.
 *
 * Newest first because this is a history rather than a queue: nothing is spent in order, and the most
 * recently closed pile is the one somebody is most likely to want back.
 *
 * Must run inside a transaction.
 */
internal fun settlementsFor(userId: String): List<VestigeSettlementResponse> {
    val rows =
        VestigeSettlement
            .selectAll()
            .where { VestigeSettlement.userId eq userId }
            .orderBy(
                VestigeSettlement.settledAt to SortOrder.DESC,
                VestigeSettlement.createdAt to SortOrder.DESC,
            ).toList()
    if (rows.isEmpty()) return emptyList()

    val lootBySettlement =
        VestigeSettlementLoot
            .selectAll()
            .where { VestigeSettlementLoot.settlementId inList rows.map { it[VestigeSettlement.id] } }
            .groupBy({ it[VestigeSettlementLoot.settlementId] }, { it[VestigeSettlementLoot.lootId].toString() })

    return rows.map { row ->
        val holder =
            VestigeHolder(
                kind = row[VestigeSettlement.holderKind],
                personId = row[VestigeSettlement.personId]?.toString(),
                characterName = row[VestigeSettlement.characterName],
            )
        VestigeSettlementResponse(
            id = row[VestigeSettlement.id].toString(),
            holder = holder,
            lootIds = lootBySettlement[row[VestigeSettlement.id]].orEmpty(),
            unpaid = row[VestigeSettlement.unpaid],
            settledAt = row[VestigeSettlement.settledAt].toString(),
        )
    }
}
