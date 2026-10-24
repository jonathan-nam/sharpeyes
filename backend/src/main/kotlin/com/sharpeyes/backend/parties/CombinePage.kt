package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.PartyCombine
import com.sharpeyes.backend.db.Person
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What the Combine Parties page reads. See CombineParties.kt. Inside a transaction, like the rest.

/** What GET /api/party-combines answers. */
internal fun combinePage(
    userId: String,
    now: Instant,
): CombinePageResponse {
    val pairs = combinablePairs(userId)
    val ids = pairs.flatMap { listOf(it.mine.id, it.theirs.id) }
    val proposals =
        PartyCombine
            .selectAll()
            .where { PartyCombine.keepPartyId inList ids }
            .toList()
    val bosses =
        BossCatalog
            .selectAll()
            .where { BossCatalog.id inList pairs.map { it.mine.bossId } }
            .associate { it[BossCatalog.id] to (it[BossCatalog.bossKey] to it[BossCatalog.name]) }
    val friends =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .mapNotNull { row -> row[Person.linkedUserId]?.let { it to row[Person.name] } }
            .toMap()
    val images = imagesOf(pairs.map { it.theirs.owner }.distinct())
    return CombinePageResponse(
        pairs.map { pair ->
            val proposal =
                proposals.firstOrNull { pair.isOf(it[PartyCombine.keepPartyId], it[PartyCombine.retirePartyId]) }
            val (bossKey, bossName) = bosses.getValue(pair.mine.bossId)
            // The cutoff does not depend on which is kept, so either keepable one answers it.
            val keepNow = pair.keepable.first()
            val asked =
                proposal?.let {
                    CombineProposalResponse(
                        id = it[PartyCombine.id].toString(),
                        keepPartyId = it[PartyCombine.keepPartyId].toString(),
                        yours = it[PartyCombine.proposedBy] == userId,
                    )
                }
            CombinePairResponse(
                bossKey = bossKey,
                boss = bossName,
                friend = friends[pair.theirs.owner] ?: "Friend",
                friendImage = images[pair.theirs.owner],
                mine = pair.mine.toSide(),
                theirs = pair.theirs.toSide(),
                keepable = pair.keepable.map { it.toString() },
                sharedFrom = cutoffFor(keepNow, pair.otherThan(keepNow), pair.mine.bossId, now).toString(),
                proposal = asked,
            )
        },
    )
}

private fun CombinablePair.otherThan(id: Uuid) = if (mine.id == id) theirs.id else mine.id

private fun StandingParty.toSide() = CombineSideResponse(id.toString(), leader, difficulty, members)
