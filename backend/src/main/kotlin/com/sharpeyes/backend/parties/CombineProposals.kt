package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyCombine
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
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Both owners agreeing on which party a combine keeps: one asks, the other combines or declines.
// See CombineParties.kt. Inside a transaction, like the rest.

/** Why [pair] cannot be combined keeping [keepId], or null when it can. */
private fun refusalFor(
    pair: CombinablePair?,
    keepId: Uuid?,
): CombineAnswer? =
    when {
        pair == null || keepId == null -> CombineAnswer.NotFound
        keepId !in pair.keepable ->
            CombineAnswer.Refused(Refusal("Keep the party that already has both of you."))
        else -> null
    }

/** Asks the other owner to combine [keepId] and [retireId], replacing any proposal for the pair. */
internal fun proposeCombine(
    userId: String,
    keepId: Uuid,
    retireId: Uuid,
    now: Instant,
): CombineAnswer {
    val pair = combinablePairs(userId).firstOrNull { it.isOf(keepId, retireId) }
    val refusal = refusalFor(pair, keepId)
    if (pair == null || refusal != null) return refusal ?: CombineAnswer.NotFound
    dropProposals(listOf(keepId, retireId))
    val id = Uuid.random()
    PartyCombine.insert {
        it[PartyCombine.id] = id
        it[keepPartyId] = keepId
        it[retirePartyId] = retireId
        it[proposedBy] = userId
        it[createdAt] = now
    }
    notify(
        pair.theirs.owner,
        NotificationKind.PARTY_COMBINE,
        now,
        subjectId = id,
        actorId = userId,
        payload = facts(pair),
    )
    return CombineAnswer.Done
}

/** Combines as a proposal asked, when [userId] is the owner it was waiting on. */
internal fun acceptCombine(
    userId: String,
    combineId: Uuid,
    now: Instant,
): CombineAnswer {
    val proposal = PartyCombine.selectAll().where { PartyCombine.id eq combineId }.firstOrNull()
    val keepId = proposal?.get(PartyCombine.keepPartyId)
    // Only the owner it waits on finds the pair: from the proposer's side, theirs is not the proposer.
    val pair =
        proposal?.let { p ->
            combinablePairs(userId).firstOrNull {
                it.isOf(p[PartyCombine.keepPartyId], p[PartyCombine.retirePartyId]) &&
                    it.theirs.owner == p[PartyCombine.proposedBy]
            }
        }
    val refusal = refusalFor(pair, keepId)
    if (pair == null || keepId == null || refusal != null) return refusal ?: CombineAnswer.NotFound
    val (keep, retire) = if (pair.mine.id == keepId) pair.mine to pair.theirs else pair.theirs to pair.mine
    combine(keep, retire, now)
    dropProposals(listOf(keep.id, retire.id))
    notify(pair.theirs.owner, NotificationKind.PARTY_COMBINED, now, actorId = userId, payload = facts(pair, keepId))
    return CombineAnswer.Done
}

/** Declines a proposal made to [userId], or withdraws one of theirs. */
internal fun dropCombine(
    userId: String,
    combineId: Uuid,
): Boolean {
    val proposal = PartyCombine.selectAll().where { PartyCombine.id eq combineId }.firstOrNull()
    val parties = listOfNotNull(proposal?.get(PartyCombine.keepPartyId), proposal?.get(PartyCombine.retirePartyId))
    val asked = proposal?.get(PartyCombine.proposedBy) == userId
    val owns = !Party.selectAll().where { (Party.id inList parties) and (Party.userId eq userId) }.empty()
    val involved = asked || owns
    if (involved) {
        PartyCombine.deleteWhere { PartyCombine.id eq combineId }
        resolve(NotificationKind.PARTY_COMBINE, listOf(combineId))
    }
    return involved
}

/** Every proposal involving any of [parties], and its notification. */
private fun dropProposals(parties: List<Uuid>) {
    val ids =
        PartyCombine
            .selectAll()
            .where { (PartyCombine.keepPartyId inList parties) or (PartyCombine.retirePartyId inList parties) }
            .map { it[PartyCombine.id] }
    if (ids.isEmpty()) return
    PartyCombine.deleteWhere { PartyCombine.id inList ids }
    resolve(NotificationKind.PARTY_COMBINE, ids)
}

/** What the bell names a combine by. */
private fun facts(
    pair: CombinablePair,
    kept: Uuid? = null,
) = buildJsonObject {
    put("boss", BossCatalog.selectAll().where { BossCatalog.id eq pair.mine.bossId }.single()[BossCatalog.name])
    put("difficulty", pair.mine.difficulty)
    if (kept != null) put("partyId", kept.toString())
}
