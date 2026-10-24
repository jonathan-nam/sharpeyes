package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyCombineItem
import com.sharpeyes.backend.db.PartyCombineRequest
import com.sharpeyes.backend.db.PartyCombineSeat
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import com.sharpeyes.backend.plugins.Refusal
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.batchInsert
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A combine is a merge: the sender settles every conflict, and the other owner accepts or declines
// the whole request. See CombineParties.kt. Inside a transaction, like the rest.

/**
 * What combining with one friend would do: the pairs that settle themselves, and the conflicts the
 * sender has to answer.
 *
 * A pair settles itself when only one side can be kept, or when both parties are the same people on
 * the same difficulty, which keeps the sender's. Anything else is a conflict: the rosters or the mode
 * differ, or a party matches more than one of theirs.
 */
internal class CombinePlan(
    val pairs: List<CombinablePair>,
) {
    private val shared =
        (pairs.map { it.mine.id } + pairs.map { it.theirs.id })
            .groupingBy { it }
            .eachCount()
            .filterValues { it > 1 }
            .keys

    fun autoKeep(pair: CombinablePair): Uuid? =
        when {
            pair.mine.id in shared || pair.theirs.id in shared -> null
            pair.keepable.size == 1 -> pair.keepable.single()
            pair.mine.sameAs(pair.theirs) -> pair.mine.id
            else -> null
        }

    val conflicts get() = pairs.filter { autoKeep(it) == null }
}

private fun StandingParty.sameAs(other: StandingParty) =
    difficulty == other.difficulty &&
        members.map { it.lowercase() }.toSet() == other.members.map { it.lowercase() }.toSet()

/** The account behind [personId], one of [userId]'s people, when it is linked. */
internal fun accountOf(
    userId: String,
    personId: Uuid,
): String? =
    Person
        .selectAll()
        .where { (Person.id eq personId) and (Person.userId eq userId) }
        .firstOrNull()
        ?.get(Person.linkedUserId)

internal fun planWith(
    userId: String,
    other: String,
) = CombinePlan(combinablePairs(userId).filter { it.theirs.owner == other })

/** A conflict's answer: which of the pair is kept. Every pair combines; none is left as two. */
internal data class CombineChoice(
    val mine: Uuid,
    val theirs: Uuid,
    val keep: Uuid,
)

/** A character left in two parties, and the party the sender keeps them in. */
internal data class SeatChoice(
    val name: String,
    val keepPartyId: Uuid,
)

internal fun CombinablePair.otherThan(id: Uuid) = if (mine.id == id) theirs.id else mine.id

/** What a request from [userId] to [other] would do, or why it cannot be sent as it stands. */
internal class CombineDraft(
    val other: String,
    val items: List<Pair<CombinablePair, Uuid>>,
    val seats: SeatPlan,
    val refusal: CombineAnswer?,
)

/**
 * Settles every pair and every character left in two parties, so that once it is accepted nobody
 * holds two standing parties for one boss. Unanswered pairs or clashes refuse it.
 */
internal fun draftCombine(
    userId: String,
    other: String,
    choices: List<CombineChoice>,
    seatChoices: List<SeatChoice>,
): CombineDraft {
    val plan = planWith(userId, other)
    val answered = choices.associateBy { it.mine to it.theirs }
    val items =
        plan.pairs.mapNotNull { pair ->
            val keep = plan.autoKeep(pair) ?: answered[pair.mine.id to pair.theirs.id]?.keep
            keep?.let { pair to it }
        }
    val retired = items.mapTo(mutableSetOf()) { (pair, keep) -> pair.otherThan(keep) }
    val kept = items.mapTo(mutableSetOf()) { it.second }
    val standing = standingParties(listOf(userId, other))
    val byId = standing.associateBy { it.id }
    val keepIn =
        seatChoices
            .mapNotNull { choice -> byId[choice.keepPartyId]?.let { (it.bossId to choice.name.lowercase()) to it.id } }
            .toMap()
    val seats = planSeats(standing, retired, keepIn)
    val refusal =
        when {
            plan.pairs.isEmpty() -> CombineAnswer.NotFound
            items.size < plan.pairs.size ->
                CombineAnswer.Refused(
                    Refusal("Choose which party to keep for every conflict."),
                )
            items.any { (pair, keep) -> keep !in pair.keepable } ->
                CombineAnswer.Refused(Refusal("Keep the party that already has both of you."))
            retired.any { it in kept } ->
                CombineAnswer.Refused(
                    Refusal("A party can't be kept and retired. Choose again."),
                )
            seats.open.isNotEmpty() ->
                CombineAnswer.Refused(
                    Refusal("Choose which party keeps ${seats.open.first().name}."),
                )
            else -> null
        }
    return CombineDraft(other, items, seats, refusal)
}

/** Sends [personId]'s account one request covering every pair, replacing any earlier one. */
internal fun sendCombine(
    userId: String,
    personId: Uuid,
    choices: List<CombineChoice>,
    seatChoices: List<SeatChoice>,
    now: Instant,
): CombineAnswer {
    val draft = accountOf(userId, personId)?.let { draftCombine(userId, it, choices, seatChoices) }
    val refusal = draft?.refusal
    if (draft == null || refusal != null) return refusal ?: CombineAnswer.NotFound
    dropRequests(userId, draft.other, bothWays = false)
    val id = Uuid.random()
    PartyCombineRequest.insert {
        it[PartyCombineRequest.id] = id
        it[fromUserId] = userId
        it[toUserId] = draft.other
        it[createdAt] = now
    }
    PartyCombineItem.batchInsert(draft.items) { (pair, keep) ->
        this[PartyCombineItem.requestId] = id
        this[PartyCombineItem.keepPartyId] = keep
        this[PartyCombineItem.retirePartyId] = pair.otherThan(keep)
    }
    PartyCombineSeat.batchInsert(draft.seats.drops) { (party, name) ->
        this[PartyCombineSeat.requestId] = id
        this[PartyCombineSeat.partyId] = party
        this[PartyCombineSeat.name] = name
    }
    val count = buildJsonObject { put("count", draft.items.size) }
    notify(draft.other, NotificationKind.PARTY_COMBINE, now, subjectId = id, actorId = userId, payload = count)
    return CombineAnswer.Done
}

/** The characters still to place once [choices] settle the pairs, for the sender to answer. */
internal fun previewCombine(
    userId: String,
    personId: Uuid,
    choices: List<CombineChoice>,
): List<SeatClash>? = accountOf(userId, personId)?.let { draftCombine(userId, it, choices, emptyList()).seats.open }

/** Declines a request made to [userId], or withdraws one of theirs. */
internal fun dropCombine(
    userId: String,
    requestId: Uuid,
): Boolean {
    val dropped =
        PartyCombineRequest.deleteWhere {
            (PartyCombineRequest.id eq requestId) and
                ((PartyCombineRequest.toUserId eq userId) or (PartyCombineRequest.fromUserId eq userId))
        } > 0
    if (dropped) resolve(NotificationKind.PARTY_COMBINE, listOf(requestId))
    return dropped
}

/** [from]'s request to [to], and with [bothWays] [to]'s to [from] too, notifications included. */
internal fun dropRequests(
    from: String,
    to: String,
    bothWays: Boolean,
) {
    val one = (PartyCombineRequest.fromUserId eq from) and (PartyCombineRequest.toUserId eq to)
    val other = (PartyCombineRequest.fromUserId eq to) and (PartyCombineRequest.toUserId eq from)
    val which = if (bothWays) one or other else one
    val ids = PartyCombineRequest.selectAll().where { which }.map { it[PartyCombineRequest.id] }
    if (ids.isEmpty()) return
    PartyCombineRequest.deleteWhere { PartyCombineRequest.id inList ids }
    resolve(NotificationKind.PARTY_COMBINE, ids)
}
