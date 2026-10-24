package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.alias
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// A party somebody you are linked to already keeps for a boss you are about to set up with them.
//
// Two accounts each keeping a pool for one night is the same night counted twice. Offered rather
// than refused: a party can really be a different one (another group, another mode on another
// character), and the request says so with `separate`. Inside a transaction, like the rest.

/**
 * The party of a linked account's that a new [characterId] party for [bossId] with [members] would
 * duplicate, or null. It duplicates when your character already sits in theirs, or their party's
 * own character is one of the members you are seating.
 */
internal fun sharedDuplicateOf(
    userId: String,
    characterId: Uuid,
    bossId: Uuid,
    members: List<String>,
): DuplicateParty? {
    val linked = linkedAccountsOf(userId)
    val named = members.map { it.trim().lowercase() }.toSet()
    val theirs = Characters.alias("their_own")
    val party =
        if (linked.isEmpty()) {
            null
        } else {
            Party
                .join(theirs, JoinType.INNER, Party.characterId, theirs[Characters.id])
                .join(BossCatalog, JoinType.INNER, Party.bossCatalogId, BossCatalog.id)
                .selectAll()
                .where {
                    (Party.userId inList linked) and
                        (Party.bossCatalogId eq bossId) and
                        (Party.standing eq true) and
                        (Party.solo eq false)
                }.firstOrNull { row ->
                    row[theirs[Characters.name]].lowercase() in named || seats(row[Party.id], characterId)
                }
        }
    return party?.let {
        DuplicateParty(
            refusal = duplicateRefusal(it[theirs[Characters.name]], it[BossCatalog.name]),
            partyId = it[Party.id].toString(),
        )
    }
}

/** What the form says: whose party it is, and the two ways on. */
private fun duplicateRefusal(
    character: String,
    boss: String,
): String = "$character already has a $boss party with you. Open theirs, or add yours anyway."

/** Whether a standing seat of [partyId]'s is your [characterId]. */
private fun seats(
    partyId: Uuid,
    characterId: Uuid,
): Boolean =
    PartyMember
        .selectAll()
        .where {
            (PartyMember.partyId eq partyId) and
                (PartyMember.standing eq true) and
                (PartyMember.linkedCharacterId eq characterId)
        }.empty()
        .not()

/** The accounts [userId] is linked to, from either side: their person rows, or yours for them. */
internal fun linkedAccountsOf(userId: String): List<String> {
    val mine =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .mapNotNull { it[Person.linkedUserId] }
    val theirs =
        Person
            .selectAll()
            .where { Person.linkedUserId eq userId }
            .map { it[Person.userId] }
    return (mine + theirs).filter { it != userId }.distinct()
}
