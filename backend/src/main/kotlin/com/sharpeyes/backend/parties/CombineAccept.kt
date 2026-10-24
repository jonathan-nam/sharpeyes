package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyCombineItem
import com.sharpeyes.backend.db.PartyCombineRequest
import com.sharpeyes.backend.db.PartyCombineSeat
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.plugins.Refusal
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Accepting a combine request: all of it or none of it. See CombineProposals.kt. Inside a
// transaction, like the rest.

private sealed interface Acceptance {
    data class Ready(
        val from: String,
        val merges: List<Pair<StandingParty, StandingParty>>,
        val drops: List<Pair<StandingParty, String>>,
    ) : Acceptance

    data class Stale(
        val answer: CombineAnswer,
    ) : Acceptance
}

/**
 * Combines every pair of a request made TO [userId] and takes out the seats it names.
 *
 * Checked whole before anything is written, against the parties as they are now: a pair that no
 * longer matches, or a character who would still hold two parties for one boss, refuses the lot
 * rather than applying the part that still fits.
 */
internal fun acceptCombine(
    userId: String,
    requestId: Uuid,
    now: Instant,
): CombineAnswer {
    val ready =
        when (val acceptance = acceptanceOf(userId, requestId)) {
            is Acceptance.Ready -> acceptance
            is Acceptance.Stale -> return acceptance.answer
        }
    for ((party, name) in ready.drops) takeOutSeat(party, name, now)
    for ((keep, retire) in ready.merges) combine(keep, retire, now)
    dropRequests(userId, ready.from, bothWays = true)
    val count = buildJsonObject { put("count", ready.merges.size) }
    notify(ready.from, NotificationKind.PARTY_COMBINED, now, actorId = userId, payload = count)
    return CombineAnswer.Done
}

private fun acceptanceOf(
    userId: String,
    requestId: Uuid,
): Acceptance {
    val request =
        PartyCombineRequest
            .selectAll()
            .where { (PartyCombineRequest.id eq requestId) and (PartyCombineRequest.toUserId eq userId) }
            .firstOrNull() ?: return Acceptance.Stale(CombineAnswer.NotFound)
    val from = request[PartyCombineRequest.fromUserId]
    val items =
        PartyCombineItem
            .selectAll()
            .where { PartyCombineItem.requestId eq requestId }
            .map { it[PartyCombineItem.keepPartyId] to it[PartyCombineItem.retirePartyId] }
    val pairs = planWith(userId, from).pairs
    val merges =
        items.mapNotNull { (keep, retire) ->
            pairs
                .firstOrNull { it.isOf(keep, retire) && keep in it.keepable }
                ?.let { if (it.mine.id == keep) it.mine to it.theirs else it.theirs to it.mine }
        }
    val retired = items.mapTo(mutableSetOf()) { it.second }
    val byId = standingParties(listOf(userId, from)).associateBy { it.id }
    val drops =
        PartyCombineSeat
            .selectAll()
            .where { PartyCombineSeat.requestId eq requestId }
            .map { it[PartyCombineSeat.partyId] to it[PartyCombineSeat.name] }
    val seats =
        drops.mapNotNull { (party, name) ->
            byId[party]?.takeIf { it.seats(name) && it.canLose(name) }?.let { it to name }
        }
    val left = withoutSeats(byId.values.filter { it.id !in retired }, seats.map { (party, name) -> party.id to name })
    val whole =
        merges.size == items.size &&
            seats.size == drops.size &&
            items.none { it.first in retired } &&
            clashesIn(left).isEmpty()
    return if (whole) {
        Acceptance.Ready(from, merges, seats)
    } else {
        Acceptance.Stale(
            CombineAnswer.Refused(
                Refusal("These parties changed since the request. Decline it and ask for a new one."),
            ),
        )
    }
}

/** Takes [name] out of [party]'s standing roster, the way its owner removing them would. */
private fun takeOutSeat(
    party: StandingParty,
    name: String,
    now: Instant,
) {
    val seat =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId eq party.id) and (PartyMember.standing eq true) }
            .firstOrNull { it[PartyMember.name].equals(name, ignoreCase = true) } ?: return
    removeMember(party.owner, party.id, seat[PartyMember.id], now)
}
