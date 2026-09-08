package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.SettlementDebtPayout
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
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What somebody owes you that no drop accounts for: /api/settlement-debts.
//
// The Settlement Ledger could only state debts it derived, a share of a sale or a count of pieces, so
// a debt from anywhere else had nowhere to go. This is the one input on that page, and the only figure
// on it that nothing else can know.
//
// Rows, not a running total, the shape V51 uses: only the sum matters, and a mistyped one has to come
// back off.
//
// SIGNED since V57. Positive is what they owe you. Negative is a debt of YOURS discharged against it,
// which is how a share you owe is settled when the two of you agree it comes off the larger sum
// rather than money crossing. See V57 for why marking the share paid alone could not say that.

/**
 * What the insert transaction decided.
 *
 * Three outcomes, not two: a retry that lost a race is an ordinary thing for the split in #516 to do
 * and must not read as "personId is not somebody on your people list". A sentinel value was the first
 * shape of this and was wrong, since `emptyList()` is a singleton in Kotlin and would have matched a
 * legitimately empty answer by identity.
 */
private sealed interface DebtWrite {
    data class Wrote(
        val debts: List<SettlementDebtResponse>,
    ) : DebtWrite

    data object NotYourPerson : DebtWrite

    data object AlreadyDischarged : DebtWrite
}

/** The most one entry can be. A typo guard, matching MAX_AMOUNT on a payment. */
private const val MAX_AMOUNT = 1_000_000_000_000L

/** As long as a note may be, matching the check in V56. Room for what it was for, not for a story. */
private const val MAX_NOTE = 120

/** One share an offset discharged. The PAYOUT, since one drop owes several people. See V58. */
@Serializable
data class SettlementDebtPayoutRow(
    val lootId: String,
    val memberId: String,
)

@Serializable
data class SettlementDebtResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    /** The shares this discharged. Empty on a hand-entered debt, which is most of them. See V58. */
    val payouts: List<SettlementDebtPayoutRow> = emptyList(),
    val incurredAt: String,
)

@Serializable
data class AddSettlementDebtRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    /** Only an offset names any. Absent is a debt somebody typed, which discharges no share. */
    val payouts: List<SettlementDebtPayoutRow> = emptyList(),
    /**
     * When the act happened, where that is not now.
     *
     * Only splitting an old offset into its shares sends one. Those rows are the SAME act as the
     * entry they replace, so re-dating them to the day of the split would move a history entry to
     * today and lose the one fact that tells two offsets against one person apart.
     */
    val incurredAt: String? = null,
)

fun Route.settlementDebtRoutes() {
    get { listDebts() }
    post { addDebtRoute() }
    post("/offset") { offsetSharesRoute() }
    delete("/{debtId}") { deleteDebtRoute() }
}

private suspend fun RoutingContext.listDebts() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        dbQuery {
            ensureUser(userId, email)
            debtsFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addDebtRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddSettlementDebtRequest>()
    val holder = request.holder.normalised()
    val note = request.note?.trim()?.takeIf { it.isNotEmpty() }

    val refusal = debtRefusal(holder, request.amount, note, request.incurredAt)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    // Already proved parseable by debtRefusal, which refuses rather than falling back to now(): a
    // split that silently re-dates the rows it writes is the act quietly becoming three acts.
    val incurred = request.incurredAt?.let { Instant.parse(it) }

    val payouts =
        request.payouts.map { Uuid.parseOrNull(it.lootId) to Uuid.parseOrNull(it.memberId) }
    if (payouts.any { (loot, member) -> loot == null || member == null }) {
        return call.respond(HttpStatusCode.BadRequest, "malformed lootId or memberId")
    }

    val result =
        dbQuery {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            // Scoped to the account, the check the foreign key does not make. See ownsPerson.
            if (holder.kind == "PERSON" && !ownsPerson(userId, person)) {
                return@dbQuery DebtWrite.NotYourPerson
            }

            val now = Clock.System.now()
            val newDebtId = Uuid.random()
            SettlementDebt.insert {
                it[id] = newDebtId
                it[SettlementDebt.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[amount] = request.amount
                it[SettlementDebt.note] = note
                // The act's own day, not the day the row was written. See AddSettlementDebtRequest.
                it[incurredAt] = incurred ?: now
                it[createdAt] = now
            }
            val shares = payouts.map { it.first!! to it.second!! }
            if (anyDischarged(shares)) return@dbQuery DebtWrite.AlreadyDischarged

            // Whatever the offset discharged. Not checked against the payout rows themselves: the
            // settle that marked them paid ran first and is the one that had to prove they exist, and
            // a second check here would refuse a row that write had already accepted.
            for (share in shares) {
                SettlementDebtPayout.insert {
                    it[debtId] = newDebtId
                    it[lootId] = share.first
                    it[memberId] = share.second
                }
            }
            DebtWrite.Wrote(debtsFor(userId))
        }
    // The whole list, like a tranche or a payment: what a person owes you is read off all of it.
    when (result) {
        is DebtWrite.AlreadyDischarged ->
            call.respond(HttpStatusCode.Conflict, "one of those shares is already discharged")
        is DebtWrite.NotYourPerson ->
            call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
        is DebtWrite.Wrote -> call.respond(HttpStatusCode.Created, result.debts)
    }
}

private suspend fun RoutingContext.deleteDebtRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val debtId = call.parseUuidParam("debtId") ?: return
    val rows =
        dbQuery {
            ensureUser(userId, email)
            val gone =
                SettlementDebt.deleteWhere {
                    (SettlementDebt.id eq debtId) and (SettlementDebt.userId eq userId)
                } > 0
            if (gone) debtsFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/**
 * Whether any of these shares has already been discharged by some other entry.
 *
 * A share is discharged ONCE. V68 makes this an index too, so a race that gets past the check still
 * cannot write the row; this is here to answer with a sentence rather than a constraint violation.
 * See V68 for the wrong number it guards.
 *
 * The pairs are checked in Kotlin rather than as a SQL row-value list: the two `inList`s alone would
 * also match a share built from one row's loot and another's member, which is a refusal nobody could
 * explain. Must run inside a transaction.
 */
internal fun anyDischarged(shares: List<Pair<Uuid, Uuid>>): Boolean {
    if (shares.isEmpty()) return false
    return SettlementDebtPayout
        .selectAll()
        .where {
            (SettlementDebtPayout.lootId inList shares.map { it.first }) and
                (SettlementDebtPayout.memberId inList shares.map { it.second })
        }.any { it[SettlementDebtPayout.lootId] to it[SettlementDebtPayout.memberId] in shares }
}

/**
 * Why this entry cannot be recorded, or null.
 *
 * SELF is refused, where a tranche and a payment allow it. Those are about a PILE, and one of the
 * piles is yours; this is about a debt between two people, and a debt to yourself is not one.
 */
internal fun debtRefusal(
    holder: VestigeHolder,
    amount: Long,
    note: String?,
    /** Absent is now, which is every debt but a split of an older one. */
    incurredAt: String? = null,
): String? =
    when {
        holder.kind !in setOf("PERSON", "CHARACTER") ->
            "holder.kind must be one of PERSON, CHARACTER"
        // The kind and the reference cannot disagree, matching the checks in V56.
        (holder.kind == "PERSON") != (holder.personId != null) ->
            "a PERSON holder needs a personId, and nothing else does"
        (holder.kind == "CHARACTER") != (holder.characterName != null) ->
            "a CHARACTER holder needs a characterName, and nothing else does"
        holder.personId != null && runCatching { Uuid.parse(holder.personId) }.isFailure ->
            "personId is not an id"
        // SIGNED since V57. Positive is theirs to pay, negative is a debt of yours discharged
        // against it. Zero is refused: an adjustment of nothing is the absence of one.
        amount == 0L -> "amount cannot be zero"
        amount < -MAX_AMOUNT || amount > MAX_AMOUNT ->
            "amount must be between -$MAX_AMOUNT and $MAX_AMOUNT"
        note != null && note.length > MAX_NOTE -> "note must be at most $MAX_NOTE characters"
        incurredAt != null && runCatching { Instant.parse(incurredAt) }.isFailure ->
            "incurredAt is not a timestamp"
        else -> null
    }

/**
 * Every entry this account has made, oldest first.
 *
 * Only the sum matters, so the order is for reading. Oldest first to match the tranche and payment
 * lists the same card draws.
 *
 * Must run inside a transaction.
 */
internal fun debtsFor(userId: String): List<SettlementDebtResponse> {
    val rows =
        SettlementDebt
            .selectAll()
            .where { SettlementDebt.userId eq userId }
            .orderBy(
                SettlementDebt.incurredAt to SortOrder.ASC,
                SettlementDebt.createdAt to SortOrder.ASC,
            ).toList()
    if (rows.isEmpty()) return emptyList()

    // One query for every debt's shares rather than one per debt. Most carry none, so the join is
    // short and it is the round trips that would add up.
    val shares =
        SettlementDebtPayout
            .selectAll()
            .where { SettlementDebtPayout.debtId inList rows.map { it[SettlementDebt.id] } }
            .groupBy({ it[SettlementDebtPayout.debtId] }) {
                SettlementDebtPayoutRow(
                    lootId = it[SettlementDebtPayout.lootId].toString(),
                    memberId = it[SettlementDebtPayout.memberId].toString(),
                )
            }

    return rows.map {
        val holder =
            VestigeHolder(
                kind = it[SettlementDebt.holderKind],
                personId = it[SettlementDebt.personId]?.toString(),
                characterName = it[SettlementDebt.characterName],
            )
        SettlementDebtResponse(
            id = it[SettlementDebt.id].toString(),
            holder = holder,
            amount = it[SettlementDebt.amount],
            note = it[SettlementDebt.note],
            payouts = shares[it[SettlementDebt.id]] ?: emptyList(),
            incurredAt = it[SettlementDebt.incurredAt].toString(),
        )
    }
}
