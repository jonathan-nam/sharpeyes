package com.sharpeyes.backend.groups

import com.sharpeyes.api.groups.GroupRosterResponse
import com.sharpeyes.backend.db.CharacterBossSkip
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.FriendGroupMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.friends.discordUsernameOf
import com.sharpeyes.backend.friends.faceOf
import com.sharpeyes.backend.parties.inPartyFor
import com.sharpeyes.backend.parties.linkedCharactersFor
import com.sharpeyes.backend.parties.ownsCharacter
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// New Party from Group: a roster a new party starts from, one character per groupmate. A suggestion
// the form shows as editable names, never a write. Inside a transaction, like the rest.

/**
 * One character of each other member's for [bossId], beside [characterId], or null when either is
 * not [userId]'s to ask about.
 *
 * A character qualifies when it is in [characterId]'s world, runs the boss (no "doesn't run" mark),
 * is in no party for it, and binds to a seat (see linkedCharactersFor). Their main character first,
 * then the highest level. A groupmate with none is named in `missing` rather than dropped unsaid.
 */
internal fun groupRoster(
    userId: String,
    groupId: Uuid,
    characterId: Uuid,
    bossId: Uuid,
): GroupRosterResponse? {
    if (!isMember(groupId, userId) || !ownsCharacter(characterId, userId)) return null
    val world =
        Characters
            .selectAll()
            .where { Characters.id eq characterId }
            .first()[Characters.worldType]
    val bindable = linkedCharactersFor(userId).values.toSet()
    val skipped =
        CharacterBossSkip
            .selectAll()
            .where { CharacterBossSkip.bossCatalogId eq bossId }
            .mapTo(mutableSetOf()) { it[CharacterBossSkip.characterId] }
    val members = mutableListOf<String>()
    val missing = mutableListOf<String>()
    for (mate in othersIn(groupId, userId)) {
        val pick =
            charactersOf(mate, world).firstOrNull { row ->
                val id = row[Characters.id]
                id in bindable && id !in skipped && !inPartyFor(id, bossId, Uuid.NIL)
            }
        if (pick != null) members += pick[Characters.name] else missing += nameFor(userId, mate)
    }
    return GroupRosterResponse(members, missing)
}

private fun othersIn(
    groupId: Uuid,
    userId: String,
) = FriendGroupMember
    .selectAll()
    .where { FriendGroupMember.groupId eq groupId }
    .orderBy(FriendGroupMember.joinedAt, SortOrder.ASC)
    .map { it[FriendGroupMember.userId] }
    .filter { it != userId }

/** [account]'s characters in [world], their main first, then by level. */
private fun charactersOf(
    account: String,
    world: String,
): List<ResultRow> {
    val main =
        Users
            .selectAll()
            .where { Users.id eq account }
            .firstOrNull()
            ?.get(Users.mainCharacterId)
    return Characters
        .selectAll()
        .where { (Characters.userId eq account) and (Characters.worldType eq world) }
        .sortedWith(
            compareBy<ResultRow> { it[Characters.id] != main }
                .thenByDescending { it[Characters.level] ?: 0 }
                .thenBy { it[Characters.position] },
        )
}

/** What [viewer] calls [account]: their person's name, else their main character or Discord name. */
private fun nameFor(
    viewer: String,
    account: String,
): String =
    Person
        .selectAll()
        .where { (Person.userId eq viewer) and (Person.linkedUserId eq account) }
        .firstOrNull()
        ?.get(Person.name)
        ?: faceOf(account).first
        ?: discordUsernameOf(account)
        ?: "?"
