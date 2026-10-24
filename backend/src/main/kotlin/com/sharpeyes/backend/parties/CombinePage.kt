package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyCombineItem
import com.sharpeyes.backend.db.PartyCombineRequest
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.sprites.spriteProxyPath
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What Social's Combine Parties reads. See CombineParties.kt. Inside a transaction, like the rest.

/** What GET /api/party-combines answers. */
internal fun combinePage(
    userId: String,
    now: Instant,
): CombinePageResponse {
    val people =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .associate { it[Person.linkedUserId]!! to (it[Person.id] to it[Person.name]) }
    val images = imagesOf(people.keys)
    val sent =
        PartyCombineRequest
            .selectAll()
            .where { PartyCombineRequest.fromUserId eq userId }
            .associate { it[PartyCombineRequest.toUserId] to it[PartyCombineRequest.id] }
    // A friend whose request is waiting on you is answered, not asked back: two requests for one
    // set of pairs is two merges of the same thing.
    val askedBy =
        PartyCombineRequest
            .selectAll()
            .where { PartyCombineRequest.toUserId eq userId }
            .mapTo(mutableSetOf()) { it[PartyCombineRequest.fromUserId] }
    val friends =
        people.mapNotNull { (account, person) ->
            val plan = planWith(userId, account)
            if (plan.pairs.isEmpty() || account in askedBy) return@mapNotNull null
            val auto = plan.pairs.mapNotNull { plan.autoKeep(it)?.let { keep -> it.mine.id == keep } }
            CombineWithResponse(
                personId = person.first.toString(),
                friend = person.second,
                friendImage = images[account],
                matched = plan.pairs.size,
                keepsYours = auto.count { it },
                keepsTheirs = auto.count { !it },
                conflicts = sidesOf(plan.conflicts, userId, now),
                sentRequestId = sent[account]?.toString(),
            )
        }
    return CombinePageResponse(friends, incomingFor(userId, people, images))
}

private fun sidesOf(
    pairs: List<CombinablePair>,
    userId: String,
    now: Instant,
): List<CombinePairResponse> {
    val seats = seatsFor(pairs.flatMap { listOf(it.mine.id, it.theirs.id) }.distinct(), userId)
    // A seat naming the other owner's character is not bound until the two combine (see
    // bossesRunInOwnParty), so it carries no sprite of its own; both accounts' characters answer by name.
    val owners = pairs.flatMap { listOf(it.mine.owner, it.theirs.owner) }.distinct()
    val faces =
        Characters
            .selectAll()
            .where { Characters.userId inList owners }
            .mapNotNull { row ->
                row[Characters.spriteImgUrl]?.let {
                    row[Characters.name].lowercase() to
                        spriteProxyPath(it)
                }
            }.toMap()
    val bosses =
        BossCatalog
            .selectAll()
            .associate { it[BossCatalog.id] to (it[BossCatalog.bossKey] to it[BossCatalog.name]) }

    fun side(party: StandingParty): CombineSideResponse {
        val standing = seats[party.id].orEmpty().filterNot { it.guest }
        val members = standing.map { SeatFace(it.name, it.spriteImgUrl ?: faces[it.name.lowercase()]) }
        return CombineSideResponse(party.id.toString(), party.leader, party.difficulty, members)
    }
    return pairs.map { pair ->
        val (bossKey, bossName) = bosses.getValue(pair.mine.bossId)
        // The cutoff does not depend on which side is kept, so either keepable one answers it.
        val keepNow = pair.keepable.first()
        val other = if (pair.mine.id == keepNow) pair.theirs.id else pair.mine.id
        CombinePairResponse(
            bossKey = bossKey,
            boss = bossName,
            mine = side(pair.mine),
            theirs = side(pair.theirs),
            keepable = pair.keepable.map { it.toString() },
            sharedFrom = cutoffFor(keepNow, other, pair.mine.bossId, now).toString(),
        )
    }
}

/** Requests waiting on [userId], each as one line: how many pairs, and whose copy each keeps. */
private fun incomingFor(
    userId: String,
    people: Map<String, Pair<Uuid, String>>,
    images: Map<String, String>,
): List<IncomingCombineResponse> {
    val requests = PartyCombineRequest.selectAll().where { PartyCombineRequest.toUserId eq userId }.toList()
    if (requests.isEmpty()) return emptyList()
    val items =
        PartyCombineItem
            .selectAll()
            .where { PartyCombineItem.requestId inList requests.map { it[PartyCombineRequest.id] } }
            .groupBy({ it[PartyCombineItem.requestId] }, { it[PartyCombineItem.keepPartyId] })
    val mine =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .mapTo(mutableSetOf()) { it[Party.id] }
    return requests.map { request ->
        val from = request[PartyCombineRequest.fromUserId]
        val kept = items[request[PartyCombineRequest.id]].orEmpty()
        IncomingCombineResponse(
            id = request[PartyCombineRequest.id].toString(),
            friend = people[from]?.second ?: "Friend",
            friendImage = images[from],
            total = kept.size,
            keepsYours = kept.count { it in mine },
            keepsTheirs = kept.count { it !in mine },
        )
    }
}
