package com.sharpeyes.backend.parties

import com.sharpeyes.api.combine.CombinePageResponse
import com.sharpeyes.api.combine.CombinePairResponse
import com.sharpeyes.api.combine.CombineSideResponse
import com.sharpeyes.api.combine.CombineWithResponse
import com.sharpeyes.api.combine.IncomingCombineResponse
import com.sharpeyes.api.combine.SeatClashResponse
import com.sharpeyes.api.combine.SeatFace
import com.sharpeyes.api.combine.SeatOptionResponse
import com.sharpeyes.api.combine.SeatOutResponse
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyCombineItem
import com.sharpeyes.backend.db.PartyCombineRequest
import com.sharpeyes.backend.db.PartyCombineSeat
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.sprites.spriteProxyPath
import org.jetbrains.exposed.v1.core.JoinType
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

/** Every standing seat of [parties] as a face, by party, in seat order. */
private fun facesOf(
    parties: List<StandingParty>,
    userId: String,
): Map<Uuid, List<SeatFace>> {
    val seats = seatsFor(parties.map { it.id }.distinct(), userId)
    // A seat naming the other owner's character is not bound until the two combine (see
    // bossesRunInOwnParty), so it carries no sprite of its own; both accounts' characters answer by name.
    val sprites =
        Characters
            .selectAll()
            .where { Characters.userId inList parties.map { it.owner }.distinct() }
            .mapNotNull { row ->
                row[Characters.spriteImgUrl]?.let {
                    row[Characters.name].lowercase() to
                        spriteProxyPath(it)
                }
            }.toMap()
    return parties.associate { party ->
        val standing = seats[party.id].orEmpty().filterNot { it.guest }
        party.id to standing.map { SeatFace(it.name, it.spriteImgUrl ?: sprites[it.name.lowercase()]) }
    }
}

private fun bossNames() =
    BossCatalog
        .selectAll()
        .associate { it[BossCatalog.id] to (it[BossCatalog.bossKey] to it[BossCatalog.name]) }

/** The characters still to place, as the sender's merge draws them: the face, and where they could stay. */
internal fun clashResponses(
    clashes: List<SeatClash>,
    userId: String,
): List<SeatClashResponse> {
    val faces = facesOf(clashes.flatMap { it.holders }, userId)
    val bosses = bossNames()
    return clashes.map { clash ->
        val face =
            clash.holders.firstNotNullOfOrNull {
                faces[it.id].orEmpty().firstOrNull { f ->
                    f.name.equals(clash.name, true)
                }
            }
        val options =
            clash.options.map {
                SeatOptionResponse(
                    it.id.toString(),
                    it.owner == userId,
                    it.leader,
                    it.difficulty,
                )
            }
        SeatClashResponse(clash.name, bosses[clash.bossId]?.second ?: "", face?.sprite, options)
    }
}

private fun sidesOf(
    pairs: List<CombinablePair>,
    userId: String,
    now: Instant,
): List<CombinePairResponse> {
    val faces = facesOf(pairs.flatMap { listOf(it.mine, it.theirs) }, userId)
    val bosses = bossNames()

    fun side(party: StandingParty) =
        CombineSideResponse(party.id.toString(), party.leader, party.difficulty, faces[party.id].orEmpty())
    return pairs.map { pair ->
        val (bossKey, bossName) = bosses.getValue(pair.mine.bossId)
        // The cutoff does not depend on which side is kept, so either keepable one answers it.
        val keepNow = pair.keepable.first()
        CombinePairResponse(
            bossKey = bossKey,
            boss = bossName,
            mine = side(pair.mine),
            theirs = side(pair.theirs),
            keepable = pair.keepable.map { it.toString() },
            sharedFrom = cutoffFor(keepNow, pair.otherThan(keepNow), pair.mine.bossId, now).toString(),
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
    // Each of your parties by id: its boss and the character leading it, which is how a seat taken out
    // of it is named.
    val mine =
        Party
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { Party.userId eq userId }
            .associate { it[Party.id] to (it[Party.bossCatalogId] to it[Characters.name]) }
    val bosses = bossNames()
    val takesOut =
        PartyCombineSeat
            .selectAll()
            .where { PartyCombineSeat.requestId inList requests.map { it[PartyCombineRequest.id] } }
            .mapNotNull { row ->
                mine[row[PartyCombineSeat.partyId]]?.let { (boss, leader) ->
                    row[PartyCombineSeat.requestId] to
                        SeatOutResponse(row[PartyCombineSeat.name], bosses[boss]?.second ?: "", leader)
                }
            }.groupBy({ it.first }, { it.second })
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
            takesOut = takesOut[request[PartyCombineRequest.id]].orEmpty(),
        )
    }
}
