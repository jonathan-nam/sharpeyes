package com.sharpeyes.backend.parties

import com.sharpeyes.api.coupons.AddCouponSaleRequest
import com.sharpeyes.api.coupons.BOUGHT
import com.sharpeyes.api.coupons.CouponSaleResponse
import com.sharpeyes.api.coupons.CouponSaleShareRow
import com.sharpeyes.api.coupons.KEPT
import com.sharpeyes.api.coupons.SOLD
import com.sharpeyes.api.coupons.VestigeHolder
import com.sharpeyes.api.system.Refusal
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.db.VestigeTrancheShare
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.eventPerson
import com.sharpeyes.backend.events.tellLinkedOnWrite
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.refuse
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
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The one input the piece ledger runs on: /api/vestige-tranches.
//
// A tranche is "sold 50 pieces for 1.2b", and it names no boss. Which boss each piece paid for is
// worked out by frontend/lib/piece-ledger.ts, oldest cleared first, and nothing here repeats that:
// this end stores what a human entered and hands it back oldest first, which is the order the queue
// is spent in.
//
// Whose sales they are is a PERSON, not a character and not a party. One human runs several
// characters, and what the ledger settles is what that human owes; which of their inventories a
// coupon sat in is not the unit. See V39 for the three kinds of holder and why SELF is one of them.

/** The most pieces one tranche can hold, and the most a stack is worth. Typo guards, matching V38. */
private const val MAX_PIECES = 1_000_000

// Internal rather than private: VestigeTrancheShares.kt checks a creditor against the same three
// kinds and the same one disposition, and a second spelling of "PERSON" is a bug waiting for a typo.
internal const val PERSON = "PERSON"
internal const val SELF = "SELF"
internal const val CHARACTER = "CHARACTER"

/**
 * Every disposition that names a price. Only a redemption realized nothing.
 *
 * Internal because it is also who may name whose pieces it was: an attribution divides a figure, so
 * it needs one to divide. See shareRefusal.
 */
internal val PRICED = setOf(SOLD, BOUGHT)

/**
 * The piece ledger's three inputs, which are one feature under three paths.
 *
 * NOT under /api/parties: a looter's pile spans every party they loot for, and keying it to one of them
 * is the per-boss ledger this replaced.
 *
 * Five paths because they are five different facts. What became of the coupons (a tranche), what came
 * back for them (a payment, V51), somebody deciding the books are closed (a settlement, V52), what a
 * person owes you that no drop accounts for (a debt, V56), and what became of the money a sale of
 * SOMEBODY ELSE'S coupons left in your hands (a disposal, V61). Only the first can be derived from
 * anything.
 */
fun Route.vestigeLedgerRoutes() {
    ledgerRoute("/api/vestige-tranches") { vestigeRoutes() }
    ledgerRoute("/api/vestige-payments") { vestigePaymentRoutes() }
    ledgerRoute("/api/vestige-settlements") { vestigeSettlementRoutes() }
    ledgerRoute("/api/settlement-debts") { settlementDebtRoutes() }
    ledgerRoute("/api/proceeds-disposals") { proceedsDisposalRoutes() }
}

/** Every one of these is the other side's Settlement card too. See TellLinked.kt. */
private fun Route.ledgerRoute(
    path: String,
    mount: Route.() -> Unit,
) = route(path) {
    tellLinkedOnWrite(Topic.SETTLEMENT, Topic.LOOT)
    mount()
}

fun Route.vestigeRoutes() {
    get { listTranches() }
    post { addTrancheRoute() }
    delete("/{trancheId}") { deleteTrancheRoute() }
    put("/{trancheId}/amount") { correctTrancheRoute() }
}

private suspend fun RoutingContext.listTranches() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        dbQuery {
            ensureUser(userId, email)
            tranchesFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addTrancheRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddCouponSaleRequest>()
    call.eventPerson(request.holder.personId)
    val holder = request.holder.normalised()

    val disposition = request.disposition.trim().uppercase()
    val shares = request.shares.map { CouponSaleShareRow(it.holder.normalised(), it.pieces) }
    val refusal =
        trancheRefusal(holder, request.pieces, request.amount, disposition)
            ?: shareRefusal(holder, request.pieces, disposition, shares)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)
    // A pile somebody keeps in their own shared book is recorded there. See ownBookRefusal.
    val shared = dbQuery { ownBookRefusal(userId, holder.personId?.let(Uuid::parseOrNull)) }
    if (shared != null) return call.refuse(HttpStatusCode.Conflict, Refusal(shared))

    val result =
        dbQuery {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            // Scoped to the account, which the foreign key does not do: without this a tranche could be
            // filed against somebody else's person and read back as one of theirs.
            if (holder.kind == PERSON && !ownsPerson(userId, person)) return@dbQuery null
            // The same check for every creditor named. A share filed against somebody else's person
            // would credit a stranger and read back on this account's ledger as a debt discharged.
            val creditors =
                shares.map { it.holder.personId?.let { id -> runCatching { Uuid.parse(id) }.getOrNull() } }
            shares.forEachIndexed { i, share ->
                if (share.holder.kind == PERSON && !ownsPerson(userId, creditors[i])) {
                    return@dbQuery null
                }
            }

            val now = Clock.System.now()
            val trancheId = Uuid.random()
            VestigeTranche.insert {
                it[id] = trancheId
                it[VestigeTranche.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[pieces] = request.pieces
                it[amount] = request.amount
                it[VestigeTranche.disposition] = disposition
                it[soldAt] = now
                it[createdAt] = now
            }
            shares.forEachIndexed { i, share ->
                VestigeTrancheShare.insert {
                    it[id] = Uuid.random()
                    it[VestigeTrancheShare.trancheId] = trancheId
                    it[holderKind] = share.holder.kind
                    it[personId] = creditors[i]
                    it[characterName] = share.holder.characterName
                    it[pieces] = share.pieces
                    it[createdAt] = now
                }
            }
            tranchesFor(userId)
        }
    // The whole tally, not the one row: the queue is re-spent from all of it, so a client redrawing
    // from one added row would be guessing at where the pieces landed.
    if (result == null) {
        call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
    } else {
        call.respond(HttpStatusCode.Created, result)
    }
}

private suspend fun RoutingContext.deleteTrancheRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val trancheId = call.parseUuidParam("trancheId") ?: return
    val rows =
        dbQuery {
            ensureUser(userId, email)
            val gone =
                VestigeTranche.deleteWhere {
                    // Not a row a member wrote into this book: each side takes back only its own. V88.
                    (VestigeTranche.id eq trancheId) and (VestigeTranche.userId eq userId) and
                        (VestigeTranche.recordedByUserId.isNull() or (VestigeTranche.recordedByUserId eq userId))
                } > 0
            if (gone) tranchesFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/** Trimmed, and the name folded, so one pile cannot arrive under two spellings. */
internal fun VestigeHolder.normalised(): VestigeHolder =
    VestigeHolder(
        kind = kind.trim().uppercase(),
        personId = personId?.trim()?.takeIf { it.isNotEmpty() },
        characterName = characterName?.trim()?.lowercase()?.takeIf { it.isNotEmpty() },
    )

/**
 * True when this person is on the user's people list.
 *
 * The check the foreign key does not make, and the one every write that names a PERSON holder starts
 * with: without it a tranche, a payment or a debt could be filed against somebody else's person and
 * read back on this account as one of theirs. Null is never owned, so an unparseable id is refused
 * rather than treated as absent.
 *
 * Beside normalised() because the three holder routes share both.
 *
 * Must run inside a transaction.
 */
internal fun ownsPerson(
    userId: String,
    personId: Uuid?,
): Boolean =
    personId != null &&
        Person
            .selectAll()
            .where { (Person.id eq personId) and (Person.userId eq userId) }
            .empty()
            .not()

/** Why this tranche cannot be recorded, or null. */
internal fun trancheRefusal(
    holder: VestigeHolder,
    pieces: Double,
    amount: Long?,
    disposition: String = SOLD,
): String? =
    when {
        holder.kind !in setOf(PERSON, SELF, CHARACTER) ->
            "holder.kind must be one of $PERSON, $SELF, $CHARACTER"
        disposition !in setOf(SOLD, KEPT, BOUGHT) ->
            "disposition must be one of $SOLD, $KEPT, $BOUGHT"
        // Matching the constraint in V50. A KEPT row carrying money would price the very pieces it
        // exists to say were never priced, and a priced row without it prices them at nothing.
        (disposition in PRICED) != (amount != null) ->
            "a $SOLD or $BOUGHT tranche needs an amount, and a $KEPT one has none"
        // The kind and the reference cannot disagree, matching the constraints in V39: a PERSON pile
        // with no person is a pile belonging to nobody.
        (holder.kind == PERSON) != (holder.personId != null) ->
            "a $PERSON holder needs a personId, and nothing else does"
        (holder.kind == CHARACTER) != (holder.characterName != null) ->
            "a $CHARACTER holder needs a characterName, and nothing else does"
        holder.personId?.let { runCatching { Uuid.parse(it) }.isFailure } == true ->
            "personId is not an id"
        pieces <= 0 || pieces > MAX_PIECES -> "pieces must be above 0 and at most $MAX_PIECES"
        // Zero is refused, where V38 documented it as how a stack handed over rather than sold was
        // recorded. It prices those pieces at nothing and folds that into the pro rata average, so
        // the creditor absorbs their share of a loss the holder chose. $KEPT is the same event with
        // the incidence right: the pieces leave the sellable pile and come off the holder's own
        // entitlement first. See #290.
        amount != null && amount < 1 ->
            "a sale needs an amount above zero. A stack that fetched nothing is $KEPT"
        else -> null
    }

/**
 * Every tranche this account has entered, oldest first, each with whose pieces it was.
 *
 * Oldest first because that is the order the queue spends them in: the first pieces sold pay for the
 * boss cleared first. Reversing this would re-price every boss.
 *
 * Must run inside a transaction.
 */
internal fun tranchesFor(
    userId: String,
    viewer: String = userId,
): List<CouponSaleResponse> {
    val rows =
        VestigeTranche
            .selectAll()
            .where { VestigeTranche.userId eq userId }
            .orderBy(
                VestigeTranche.soldAt to SortOrder.ASC,
                VestigeTranche.createdAt to SortOrder.ASC,
            ).toList()

    // One query for every tranche's shares rather than one per tranche. Almost all of them have
    // none, so the join is short and the round trips are what would add up.
    val shares =
        VestigeTrancheShare
            .selectAll()
            .where { VestigeTrancheShare.trancheId inList rows.map { it[VestigeTranche.id] } }
            .orderBy(VestigeTrancheShare.createdAt to SortOrder.ASC)
            .groupBy({ it[VestigeTrancheShare.trancheId] }) {
                val creditor =
                    VestigeHolder(
                        kind = it[VestigeTrancheShare.holderKind],
                        personId = it[VestigeTrancheShare.personId]?.toString(),
                        characterName = it[VestigeTrancheShare.characterName],
                    )
                CouponSaleShareRow(creditor, it[VestigeTrancheShare.pieces])
            }

    val writer = { row: ResultRow -> row[VestigeTranche.recordedByUserId] ?: userId }
    val names = loggerNames(viewer, rows.map(writer))
    return rows.map {
        val holder =
            VestigeHolder(
                kind = it[VestigeTranche.holderKind],
                personId = it[VestigeTranche.personId]?.toString(),
                characterName = it[VestigeTranche.characterName],
            )
        CouponSaleResponse(
            id = it[VestigeTranche.id].toString(),
            holder = holder,
            pieces = it[VestigeTranche.pieces],
            amount = it[VestigeTranche.amount],
            disposition = it[VestigeTranche.disposition],
            shares = shares[it[VestigeTranche.id]] ?: emptyList(),
            soldAt = it[VestigeTranche.soldAt].toString(),
            recordedByYou = writer(it) == viewer,
            recordedByName = names[writer(it)],
        )
    }
}
