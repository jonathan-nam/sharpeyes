package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.AuthUser
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

/**
 * Per party, every account in it, the owner first, for the parties that reach more than one. A party
 * only you are in maps to nothing, so a row with nobody else linked draws nothing. Inside a transaction.
 */
internal fun accountsFor(
    partyIds: List<Uuid>,
    viewer: String,
): Map<Uuid, List<PartyAccountResponse>> {
    if (partyIds.isEmpty()) return emptyMap()
    val owners =
        Party
            .selectAll()
            .where { Party.id inList partyIds }
            .associate { it[Party.id] to it[Party.userId] }
    // Standing seats only, which is who audienceOf tells: a member who left is not in it any more.
    val linked =
        PartyMember
            .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
            .selectAll()
            .where {
                (PartyMember.partyId inList partyIds) and
                    PartyMember.linkedCharacterId.isNotNull() and
                    (PartyMember.standing eq true)
            }.groupBy({ it[PartyMember.partyId] }, { it[Characters.userId] })
    val accounts =
        partyIds
            .associateWith { id ->
                val owner = owners[id] ?: return@associateWith emptyList()
                (listOf(owner) + linked[id].orEmpty()).distinct()
            }.filterValues { it.size > 1 }

    val everyone = accounts.values.flatten().toSet()
    val images = imagesOf(everyone)
    val names = loggerNames(viewer, everyone)
    return accounts.mapValues { (id, users) ->
        users.map { user ->
            PartyAccountResponse(
                name = names[user],
                image = images[user],
                leader = user == owners[id],
                you = user == viewer,
            )
        }
    }
}

/** Each account's Discord avatar, for those that have one. Inside a transaction. */
internal fun imagesOf(accounts: Collection<String>): Map<String, String> =
    if (accounts.isEmpty()) {
        emptyMap()
    } else {
        AuthUser
            .selectAll()
            .where { AuthUser.id inList accounts.toSet() }
            .mapNotNull { row -> row[AuthUser.image]?.let { row[AuthUser.id] to it } }
            .toMap()
    }

/** One account's Discord avatar. */
internal fun imageOf(account: String): String? = imagesOf(listOf(account))[account]
