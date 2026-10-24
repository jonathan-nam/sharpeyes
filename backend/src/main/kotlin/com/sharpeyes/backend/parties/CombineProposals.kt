package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyCombineItem
import com.sharpeyes.backend.db.PartyCombineRequest
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

/** A conflict's answer: which party is kept, or null to leave the two separate. */
internal data class CombineChoice(
    val mine: Uuid,
    val theirs: Uuid,
    val keep: Uuid?,
)

/** Sends [personId]'s account one request covering every pair, replacing any earlier one. */
internal fun sendCombine(
    userId: String,
    personId: Uuid,
    choices: List<CombineChoice>,
    now: Instant,
): CombineAnswer {
    val other = accountOf(userId, personId)
    val plan = CombinePlan(other?.let { planWith(userId, it).pairs }.orEmpty())
    val answered = choices.associateBy { it.mine to it.theirs }
    val items =
        plan.pairs.mapNotNull { pair ->
            val keep = plan.autoKeep(pair) ?: answered[pair.mine.id to pair.theirs.id]?.keep
            keep?.let { pair to it }
        }
    val refusal =
        when {
            plan.pairs.isEmpty() -> CombineAnswer.NotFound
            plan.conflicts.any { answered[it.mine.id to it.theirs.id] == null } ->
                CombineAnswer.Refused(Refusal("Choose for every conflict."))
            items.any { (pair, keep) -> keep !in pair.keepable } ->
                CombineAnswer.Refused(Refusal("Keep the party that already has both of you."))
            items.isEmpty() -> CombineAnswer.Refused(Refusal("Nothing left to combine."))
            else -> null
        }
    if (refusal != null || other == null) return refusal ?: CombineAnswer.NotFound
    dropRequests(userId, other, bothWays = false)
    val id = Uuid.random()
    PartyCombineRequest.insert {
        it[PartyCombineRequest.id] = id
        it[fromUserId] = userId
        it[toUserId] = other
        it[createdAt] = now
    }
    PartyCombineItem.batchInsert(items) { (pair, keep) ->
        this[PartyCombineItem.requestId] = id
        this[PartyCombineItem.keepPartyId] = keep
        this[PartyCombineItem.retirePartyId] = if (keep == pair.mine.id) pair.theirs.id else pair.mine.id
    }
    notify(other, NotificationKind.PARTY_COMBINE, now, subjectId = id, actorId = userId, payload = count(items.size))
    return CombineAnswer.Done
}

/**
 * Combines every pair of a request made TO [userId]. A pair that no longer matches (a party since
 * retired, a roster since changed so neither seats the other) is skipped rather than guessed at.
 */
internal fun acceptCombine(
    userId: String,
    requestId: Uuid,
    now: Instant,
): CombineAnswer {
    val request =
        PartyCombineRequest
            .selectAll()
            .where { (PartyCombineRequest.id eq requestId) and (PartyCombineRequest.toUserId eq userId) }
            .firstOrNull() ?: return CombineAnswer.NotFound
    val from = request[PartyCombineRequest.fromUserId]
    val pairs = planWith(userId, from).pairs
    val retired = mutableSetOf<Uuid>()
    PartyCombineItem
        .selectAll()
        .where { PartyCombineItem.requestId eq requestId }
        .forEach { item ->
            val keepId = item[PartyCombineItem.keepPartyId]
            val retireId = item[PartyCombineItem.retirePartyId]
            val pair = pairs.firstOrNull { it.isOf(keepId, retireId) && keepId in it.keepable }
            if (pair != null && keepId !in retired && retireId !in retired) {
                val (keep, retire) = if (pair.mine.id == keepId) pair.mine to pair.theirs else pair.theirs to pair.mine
                combine(keep, retire, now)
                retired += retireId
            }
        }
    dropRequests(userId, from, bothWays = true)
    notify(from, NotificationKind.PARTY_COMBINED, now, actorId = userId, payload = count(retired.size))
    return CombineAnswer.Done
}

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
private fun dropRequests(
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

private fun count(n: Int) = buildJsonObject { put("count", n) }
