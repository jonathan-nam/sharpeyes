package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.SettlementDebtPayout
import com.sharpeyes.backend.db.VestigeProceedsDisposal
import com.sharpeyes.backend.events.eventPerson
import com.sharpeyes.backend.plugins.Refusal
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.refuse
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

// Closing what you owe somebody: POST /api/settlement-debts/offset and /sent, both registered by
// settlementDebtRoutes().
//
// Its own file, beside the entries it writes rather than inside them, because it is one act over
// three ledgers: the payout rows a settle marks paid, the entries that record what those paid for,
// and what became of the coupon money of theirs you were holding.

/** OFFSET comes off what they owe you. PAID means it left your hands and their debt did not move. */
internal const val CLOSE_OFFSET = "OFFSET"
internal const val CLOSE_PAID = "PAID"

/** One share the act discharges, with the figure the card quoted for it. */
@Serializable
data class OffsetPartRow(
    val lootId: String,
    val memberId: String,
    /**
     * This seat's share, pre-fee and POSITIVE. The entry it becomes is minus this.
     *
     * Absent when nothing is being priced, which is every share on the /sent path: money that left
     * your hands takes nothing off what they owe you, so there is no entry to carry a figure. An
     * offset that omits it is refused rather than writing an entry of nought: see closeRefusal.
     */
    val amount: Long = 0,
)

/**
 * Closing what you owe somebody, as ONE act. See V57 and V61.
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
    val parts: List<OffsetPartRow> = emptyList(),
    /**
     * Mesos of THEIRS you are holding that this act decides about, where there are any. See V61.
     *
     * The second pot the one button moves, and the reason it is in this request rather than one of
     * its own: see writeClose.
     */
    val holding: Long? = null,
    /**
     * Shares THEY owe you that the act closes too, so one press settles the pair both ways (closingNet
     * on the client, 2026-10-25). An offset takes each off what you owe them: an entry of plus this.
     */
    val received: List<OffsetPartRow> = emptyList(),
    /** Mesos of YOURS they are holding that the act decides about. Written as heldBy THEM. */
    val heldByThem: Long? = null,
)

/**
 * Every list the act moved.
 *
 * One answer because it was one write. Handing back the debts alone would leave the caller to fetch
 * the pools, which is the second round trip this endpoint exists to remove.
 */
@Serializable
data class OffsetSharesResponse(
    val pools: List<PartyLootPoolResponse>,
    val debts: List<SettlementDebtResponse>,
    val disposals: List<ProceedsDisposalResponse>,
)

/**
 * One closing act, parsed. What the two routes differ by is `kind` and nothing else.
 *
 * Together rather than as four arguments, since they travel together everywhere: `holding` without
 * `kind` is an amount with no direction, and either alone is half of what one press decided.
 */
internal data class CloseAct(
    val kind: String,
    val note: String?,
    val parts: List<OffsetPart>,
    val holding: Long?,
    val received: List<OffsetPart> = emptyList(),
    val heldByThem: Long? = null,
    /** The member writing into the owner's book, or null for the owner. See V88. */
    val recordedBy: String? = null,
)

/** One share of the act with its ids parsed, so the checks and the writes read the same values. */
internal data class OffsetPart(
    val lootId: Uuid,
    val memberId: Uuid,
    val amount: Long,
)

/** What the transaction decided. Each refusal wrote nothing at all. */
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
 * Discharges what you owe against what they owe you: POST /api/settlement-debts/offset.
 *
 * ONE act, so one request. It used to be two, a settle then an entry per share, and the halves
 * cancel: between them the ledger says the shares are paid and nothing has come off the debt, which
 * is the debt un-offset. A crash in the gap left it that way for good.
 */
internal suspend fun RoutingContext.offsetSharesRoute() = closeRoute(CLOSE_OFFSET)

/**
 * Records what you owe as SENT: POST /api/settlement-debts/sent.
 *
 * The same act pointed the other way, and over the same two pots, so it is the same write with no
 * entries on the end of it: money that left your hands took nothing off what they owe you.
 */
internal suspend fun RoutingContext.sentSharesRoute() = closeRoute(CLOSE_PAID)

private suspend fun RoutingContext.closeRoute(kind: String) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<OffsetSharesRequest>()
    // Which Settlement card this is, for the other side's screen. See tellLinkedOnWrite.
    call.eventPerson(request.holder.personId)
    val holder = request.holder.normalised()
    val note = request.note?.trim()?.takeIf { it.isNotEmpty() }

    val refusal = closeRefusal(holder, note, request, kind)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val act = closeActOf(request, kind, note)
    val result =
        dbQuery {
            ensureUser(userId, email)
            writeClose(userId, holder, act, Clock.System.now())
        }
    when (result) {
        is OffsetWrite.AlreadyDischarged ->
            call.refuse(HttpStatusCode.Conflict, Refusal("This is already settled. Reload to see it."))
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

/** [request] parsed. Every id parses: closeRefusal proved it before this is called. */
internal fun closeActOf(
    request: OffsetSharesRequest,
    kind: String,
    note: String?,
    recordedBy: String? = null,
): CloseAct {
    val parse = { row: OffsetPartRow -> OffsetPart(Uuid.parse(row.lootId), Uuid.parse(row.memberId), row.amount) }
    return CloseAct(
        kind = kind,
        note = note,
        parts = request.parts.map(parse),
        holding = request.holding,
        received = request.received.map(parse),
        heldByThem = request.heldByThem,
        recordedBy = recordedBy,
    )
}

/**
 * The settle, the entries it is recorded as, and the decision about their coupon money, in one
 * transaction.
 *
 * Every refusal is returned BEFORE anything is written, so a refused act leaves no half of itself
 * behind: settlePayouts writes nothing when it refuses, and the checks above it read only. Past them
 * the writes are one commit, which is the whole point of the endpoint.
 *
 * TWO POTS, and that is why they are one request. The shares you owe and their own money a sale left
 * in your hands both come off what they owe you, and as two requests the card drew between them:
 * Owen's debt went down by the shares, then down again by the money, for one press of one button.
 *
 * ONE ROW PER SHARE, so the history reads as the drops it was rather than as a figure naming nobody,
 * and one can be taken back without the others.
 *
 * Must run inside a transaction.
 */
internal fun writeClose(
    userId: String,
    holder: VestigeHolder,
    act: CloseAct,
    now: Instant,
): OffsetWrite {
    val kind = act.kind
    val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
    val shares = (act.parts + act.received).map { it.lootId to it.memberId }
    return when {
        // Scoped to the account, the check the foreign key does not make. See ownsPerson.
        holder.kind == "PERSON" && !ownsPerson(userId, person) -> OffsetWrite.NotYourPerson
        // Only an offset writes entries, so only an offset can collide with one.
        kind == CLOSE_OFFSET && anyDischarged(shares) -> OffsetWrite.AlreadyDischarged
        // The settle first, and it proves the rows are this account's: the inserts below name them
        // without a party to check against, exactly as the standalone POST does. It writes nothing
        // when it refuses, so this branch leaves no half of the act behind either.
        shares.isNotEmpty() && !settlePayouts(userId, shares, now) -> OffsetWrite.Unreachable
        else -> {
            val entry = Entry(userId, holder, person, act.note, act.recordedBy, now)
            if (kind == CLOSE_OFFSET) {
                // A share you owe comes off what they owe you; one they owe comes off what you owe
                // them. Each pot moves into the entries without the balance changing.
                for (part in act.parts) writeOffsetRow(entry, part, -part.amount)
                for (part in act.received) writeOffsetRow(entry, part, part.amount)
            }
            act.holding?.let { writeDisposalRow(entry, kind, it, HELD_BY_YOU) }
            act.heldByThem?.let { writeDisposalRow(entry, kind, it, HELD_BY_THEM) }
            OffsetWrite.Wrote(
                OffsetSharesResponse(allLootFor(userId), debtsFor(userId), disposalsFor(userId)),
            )
        }
    }
}

/** Who an act's rows are written for and by, and when. */
private class Entry(
    val userId: String,
    val holder: VestigeHolder,
    val person: Uuid?,
    val note: String?,
    val recordedBy: String?,
    val now: Instant,
)

/** One share's entry of [signed] mesos, and the link back to the share it discharged. See V58. */
private fun writeOffsetRow(
    entry: Entry,
    part: OffsetPart,
    signed: Long,
) {
    val newDebtId = Uuid.random()
    SettlementDebt.insert {
        it[id] = newDebtId
        it[userId] = entry.userId
        it[holderKind] = entry.holder.kind
        it[personId] = entry.person
        it[characterName] = entry.holder.characterName
        it[amount] = signed
        it[note] = entry.note
        it[incurredAt] = entry.now
        it[createdAt] = entry.now
        it[recordedByUserId] = entry.recordedBy
    }
    // The very row the settle just marked paid, so the entry can name what discharged it a month
    // later.
    SettlementDebtPayout.insert {
        it[debtId] = newDebtId
        it[lootId] = part.lootId
        it[memberId] = part.memberId
    }
}

/** What became of the coupon money one side holds. The same row POST /api/proceeds-disposals writes. */
private fun writeDisposalRow(
    entry: Entry,
    kind: String,
    amount: Long,
    heldBy: String,
) {
    VestigeProceedsDisposal.insert {
        it[id] = Uuid.random()
        it[userId] = entry.userId
        it[holderKind] = entry.holder.kind
        it[personId] = entry.person
        it[characterName] = entry.holder.characterName
        it[VestigeProceedsDisposal.amount] = amount
        it[VestigeProceedsDisposal.kind] = kind
        it[VestigeProceedsDisposal.heldBy] = heldBy
        it[decidedAt] = entry.now
        it[createdAt] = entry.now
        it[recordedByUserId] = entry.recordedBy
    }
}

/**
 * Why this act cannot be recorded, or null.
 *
 * Every share row against the rules a typed entry meets, since an offset's rows become entries, and
 * the held money against the rules the standalone disposal meets, since it becomes that row.
 */
internal fun closeRefusal(
    holder: VestigeHolder,
    note: String?,
    request: OffsetSharesRequest,
    kind: String,
): String? {
    val all = request.parts + request.received
    return when {
        // No pot is nothing happening, and it would still answer 201.
        all.isEmpty() && request.holding == null && request.heldByThem == null ->
            "name at least one share or an amount to settle"
        // Positive on the way in, signed in the ledger by direction. A negative here would write an
        // entry running the opposite way under the word "offset". Only an offset becomes an entry:
        // sending marks shares paid and prices nothing.
        kind == CLOSE_OFFSET && all.any { it.amount <= 0 } -> "a share to offset must be above zero"
        all.any { Uuid.parseOrNull(it.lootId) == null || Uuid.parseOrNull(it.memberId) == null } ->
            "malformed lootId or memberId"
        // Past the branch above, every id parses. Refused rather than left to the index in V68: both
        // rows are legitimate on their own, and a constraint violation reads as a bug where this
        // reads as the double count it is. Across both directions, since one share is one row.
        all.map { Uuid.parse(it.lootId) to Uuid.parse(it.memberId) }.toSet().size != all.size ->
            "the same share is named twice"
        // Every pot, never whichever is checked first: an act carrying a bad share AND a bad amount
        // would have been refused for one and written the other on the retry.
        else -> potRefusal(holder, note, request, kind)
    }
}

/** The held amounts against the disposal rules, and an offset's entries against the debt rules. */
private fun potRefusal(
    holder: VestigeHolder,
    note: String?,
    request: OffsetSharesRequest,
    kind: String,
): String? {
    val entries =
        if (kind == CLOSE_OFFSET) request.parts.map { -it.amount } + request.received.map { it.amount } else emptyList()
    return request.holding?.let { disposalRefusal(holder, it, kind, HELD_BY_YOU) }
        ?: request.heldByThem?.let { disposalRefusal(holder, it, kind, HELD_BY_THEM) }
        ?: entries.firstNotNullOfOrNull { debtRefusal(holder, it, note) }
}
