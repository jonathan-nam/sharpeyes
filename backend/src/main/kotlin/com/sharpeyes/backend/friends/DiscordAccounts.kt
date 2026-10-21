package com.sharpeyes.backend.friends

import com.sharpeyes.backend.db.AuthAccount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.DiscordUsername
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.invites.senderNameFor
import com.sharpeyes.backend.sprites.spriteProxyPath
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Which account a Discord username is, and how somebody else's account is shown. See V86.

private const val DISCORD = "discord"

private fun usernames() =
    DiscordUsername.join(AuthAccount, JoinType.INNER, DiscordUsername.discordId, AuthAccount.accountId)

/** [userId]'s Discord username, if they have signed in with Discord since V86. */
internal fun discordUsernameOf(userId: String): String? =
    usernames()
        .selectAll()
        .where { (AuthAccount.userId eq userId) and (AuthAccount.providerId eq DISCORD) }
        .firstOrNull()
        ?.get(DiscordUsername.username)

/** The account signed in as [username], matched the way Discord matches it. */
internal fun accountNamed(username: String): String? {
    val wanted = username.trim().removePrefix("@").lowercase()
    if (wanted.isEmpty()) return null
    return usernames()
        .join(Users, JoinType.INNER, AuthAccount.userId, Users.id)
        .selectAll()
        .where { (DiscordUsername.username.lowerCase() eq wanted) and (AuthAccount.providerId eq DISCORD) }
        .firstOrNull()
        ?.get(AuthAccount.userId)
}

/** [userId]'s main character's name and sprite, which is how they are shown to somebody else. */
internal fun faceOf(userId: String): Pair<String?, String?> {
    val name = senderNameFor(userId) ?: return null to null
    val sprite =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and (Characters.name eq name) }
            .firstOrNull()
            ?.get(Characters.spriteImgUrl)
            ?.let { spriteProxyPath(it) }
    return name to sprite
}

/** Everybody [userId] is linked to, by invite or by request, as the person they call them. */
internal fun friendsOf(userId: String): List<Pair<Uuid, String>> =
    Person
        .selectAll()
        .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
        .map { it[Person.id] to it[Person.linkedUserId]!! }
