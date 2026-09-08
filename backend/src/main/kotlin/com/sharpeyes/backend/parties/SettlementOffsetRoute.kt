package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.SettlementDebtPayout
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.jdbc.insert
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Discharging shares you owe against what somebody owes you: POST /api/settlement-debts/offset,
// registered by settlementDebtRoutes().
//
// Its own file, beside the entries it writes rather than inside them, because it is one act over two
// ledgers: the payout rows a settle marks paid, and the entries that record what those paid for.

/** One share an offset discharges, with the figure the card quoted for it. */
@Serializable
data class OffsetPartRow(
    val lootId: String,
    val memberId: String,
    /** This seat's share, pre-fee and POSITIVE. The entry it becomes is minus this. */
    val amount: Long,
)

/**
 * Discharging shares you owe against what somebody owes you, as ONE act. See V57.
 *
 * The client's figure per share, not one derived here. It is what the button quoted before it was
 * pressed, and a server that recomputed it could record a sum nobody agreed to: the pre-fee and
 * post-fee readings of one share differ by 5%, which is a discrepancy this card has already shipped
 * once.
 */
@Serializable
data class OffsetSharesRequest(
    val holder: VestigeHolder,
    val note: String? = null,
    val parts: List<OffsetPartRow>,
)

/**
 * Both lists the act moved.
 *
 * One answer because it was one write. Handing back the debts alone would leave the caller to fetch
 * the pools, which is the second round trip this endpoint exists to remove.
 */
@Serializable
data class OffsetSharesResponse(
    val pools: List<PartyLootPoolResponse>,
    val debts: List<SettlementDebtResponse>,
)

/** One share of an offset with its ids parsed, so the checks and the writes read the same values. */
internal data class OffsetPart(
    val lootId: Uuid,
    val memberId: Uuid,
    val amount: Long,
)

/** What the offset transaction decided. Each refusal wrote nothing at all. */
internal sealed interface OffsetWrite {
    data class Wrote(
        val answer: OffsetSharesResponse,
    ) : OffsetWrite

    data object NotYourPerson : OffsetWrite

    data object AlreadyDischarged : OffsetWrite

    /** A drop or a seat this account cannot reach. settlePayouts' own refusal. */
    data object Unreachable : OffsetWrite
}

/**
 * Discharges shares you owe against what they owe you: POST /api/settlement-debts/offset.
 *
 * ONE act, so one request. It used to be two, a settle then an entry per share, and the halves
 * cancel: between them the ledger says the shares are paid and nothing has come off the debt, which
 * is the debt un-offset and a figure nobody should be able to read. A crash in the gap left it that
 * way for good.
 *
 * Answers with the pools AND the entries, because it moved both.
 */
internal suspend fun RoutingContext.offsetSharesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<OffsetSharesRequest>()
    val holder = request.holder.normalised()
    val note = request.note?.trim()?.takeIf { it.isNotEmpty() }

    val refusal = offsetRefusal(holder, note, request.parts)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    // Every id parses: offsetRefusal proved it.
    val parts =
        request.parts.map { OffsetPart(Uuid.parse(it.lootId), Uuid.parse(it.memberId), it.amount) }

    val result =
        dbQuery {
            ensureUser(userId, email)
            writeOffset(userId, holder, note, parts, Clock.System.now())
        }
    when (result) {
        is OffsetWrite.AlreadyDischarged ->
            call.respond(HttpStatusCode.Conflict, "one of those shares is already discharged")
        is OffsetWrite.NotYourPerson ->
            call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
        is OffsetWrite.Unreachable ->
            call.respond(
                HttpStatusCode.NotFound,
                "a drop or member named here is not in your parties any more",
            )
        is OffsetWrite.Wrote -> call.respond(HttpStatusCode.Created, result.answer)
    }
}

/**
 * The settle and the entries it is recorded as, in one transaction.
 *
 * Every refusal is returned BEFORE anything is written, so a refused offset leaves no half of itself
 * behind: settlePayouts writes nothing when it refuses, and the checks above it read only. Past them
 * the two writes are one commit, which is the whole point of the endpoint.
 *
 * ONE ROW PER SHARE, so the history reads as the drops it was rather than as a figure naming nobody,
 * and one can be taken back without the others.
 *
 * Must run inside a transaction.
 */
internal fun writeOffset(
    userId: String,
    holder: VestigeHolder,
    note: String?,
    parts: List<OffsetPart>,
    now: Instant,
): OffsetWrite {
    val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
    val shares = parts.map { it.lootId to it.memberId }
    return when {
        // Scoped to the account, the check the foreign key does not make. See ownsPerson.
        holder.kind == "PERSON" && !ownsPerson(userId, person) -> OffsetWrite.NotYourPerson
        anyDischarged(shares) -> OffsetWrite.AlreadyDischarged
        // The settle first, and it proves the rows are this account's: the inserts below name them
        // without a party to check against, exactly as the standalone POST does. It writes nothing
        // when it refuses, so this branch leaves no half of the act behind either.
        !settlePayouts(userId, shares, now) -> OffsetWrite.Unreachable
        else -> {
            for (part in parts) writeOffsetRow(userId, holder, person, note, part, now)
            OffsetWrite.Wrote(OffsetSharesResponse(allLootFor(userId), debtsFor(userId)))
        }
    }
}

/** One share's entry, and the link back to the share it discharged. See V58. */
private fun writeOffsetRow(
    userId: String,
    holder: VestigeHolder,
    person: Uuid?,
    note: String?,
    part: OffsetPart,
    now: Instant,
) {
    val newDebtId = Uuid.random()
    SettlementDebt.insert {
        it[id] = newDebtId
        it[SettlementDebt.userId] = userId
        it[holderKind] = holder.kind
        it[personId] = person
        it[characterName] = holder.characterName
        it[amount] = -part.amount
        it[SettlementDebt.note] = note
        it[incurredAt] = now
        it[createdAt] = now
    }
    // The very row the settle just marked paid, so the entry can name what discharged it a month
    // later.
    SettlementDebtPayout.insert {
        it[debtId] = newDebtId
        it[lootId] = part.lootId
        it[memberId] = part.memberId
    }
}

/**
 * Why this offset cannot be recorded, or null.
 *
 * Every row against the rules a typed entry meets, since every row becomes one.
 */
private fun offsetRefusal(
    holder: VestigeHolder,
    note: String?,
    parts: List<OffsetPartRow>,
): String? =
    when {
        parts.isEmpty() -> "name at least one share to offset"
        // Positive on the way in, negative in the ledger. A negative here would write an entry that
        // ADDS to what they owe you under the word "offset", the opposite act wearing its name.
        parts.any { it.amount <= 0 } -> "a share to offset must be above zero"
        parts.any { Uuid.parseOrNull(it.lootId) == null || Uuid.parseOrNull(it.memberId) == null } ->
            "malformed lootId or memberId"
        // Past the branch above, every id parses. Refused rather than left to the index in V68: both
        // rows are legitimate on their own, and a constraint violation reads as a bug where this
        // reads as the double count it is.
        parts.map { Uuid.parse(it.lootId) to Uuid.parse(it.memberId) }.toSet().size != parts.size ->
            "the same share is named twice"
        else -> parts.firstNotNullOfOrNull { debtRefusal(holder, -it.amount, note) }
    }
