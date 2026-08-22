package com.maplestorage.backend.users

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.sprites.spriteProxyPath
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

// The account's own settings. Mirrored by the frontend's types/settings.ts field-for-field.

@Serializable
data class SettingsResponse(
    // INTERACTIVE or HEROIC: the world the site is currently answering for. See activeWorldFor.
    val worldType: String,
    // Whether anything in the world being shown can change hands. Every meso figure hangs off it.
    val trades: Boolean,
    // How many characters the OTHER world holds.
    //
    // The one thing a mode cannot leave unsaid. Narrowing to one world hides the rest of the
    // account by design, and a screen that is empty because you are standing in the wrong world
    // looks exactly like a screen that is empty because you have nothing.
    val otherWorldCharacters: Int,
    // The character drawn as the account avatar, or null for none.
    //
    // Not narrowed to the active world, unlike everything above it. The avatar says whose account
    // this is, which does not change when you look at the other half of it.
    val mainCharacterId: String? = null,
    // That character's sprite, joined fresh rather than stored: see V66.
    val mainCharacterSprite: String? = null,
)

@Serializable
data class SaveSettingsRequest(
    val worldType: String,
)

/** null clears the choice. Its own route, so that "leave it alone" and "set it to none" differ. */
@Serializable
data class SaveMainCharacterRequest(
    val characterId: String? = null,
)

fun Route.settingsRoutes() {
    get { getSettings() }
    put { saveSettings() }
    put("/main-character") { saveMainCharacter() }
}

private suspend fun RoutingContext.getSettings() {
    val (userId, email) = call.principalIdAndEmail()
    val settings =
        transaction {
            ensureUser(userId, email)
            settingsFor(userId)
        }
    call.respond(settings)
}

internal fun settingsFor(userId: String): SettingsResponse {
    val world = activeWorldFor(userId)
    val elsewhere =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and (Characters.worldType neq world) }
            .count()
            .toInt()
    val main =
        Users
            .join(
                Characters,
                JoinType.LEFT,
                onColumn = Users.mainCharacterId,
                otherColumn = Characters.id,
            ).select(Users.mainCharacterId, Characters.spriteImgUrl)
            .where { Users.id eq userId }
            .single()

    return SettingsResponse(
        worldType = world,
        trades = world == WORLD_INTERACTIVE,
        otherWorldCharacters = elsewhere,
        mainCharacterId = main[Users.mainCharacterId]?.toString(),
        mainCharacterSprite = main[Characters.spriteImgUrl]?.let(::spriteProxyPath),
    )
}

private suspend fun RoutingContext.saveSettings() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SaveSettingsRequest>()
    val worldType = worldTypeOrNull(request.worldType)
    if (worldType == null) {
        call.respond(HttpStatusCode.BadRequest, "worldType must be INTERACTIVE or HEROIC")
        return
    }

    val settings =
        transaction {
            ensureUser(userId, email)
            setActiveWorld(userId, worldType)
            settingsFor(userId)
        }

    call.respond(settings)
}

private suspend fun RoutingContext.saveMainCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SaveMainCharacterRequest>()

    val characterId = request.characterId?.let { Uuid.parseOrNull(it) }
    if (request.characterId != null && characterId == null) {
        call.respond(HttpStatusCode.BadRequest, "malformed characterId")
        return
    }

    val settings =
        transaction {
            ensureUser(userId, email)
            if (!setMainCharacter(userId, characterId)) return@transaction null
            settingsFor(userId)
        }

    // 404 rather than 403, matching the character routes: a 403 would confirm the id exists.
    if (settings == null) {
        call.respond(HttpStatusCode.NotFound, "no such character")
        return
    }
    call.respond(settings)
}

/**
 * Point the account avatar at one of your own characters, or at none.
 *
 * Returns false for a character that is not yours, which is the only reason this is checked rather
 * than written straight through: an unchecked id would draw a stranger's sprite in your header.
 */
internal fun setMainCharacter(
    userId: String,
    characterId: Uuid?,
): Boolean {
    if (characterId != null) {
        val owned =
            !Characters
                .selectAll()
                .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
                .empty()
        if (!owned) return false
    }
    Users.update({ Users.id eq userId }) { it[mainCharacterId] = characterId }
    return true
}

/**
 * Point the site at a world. Moves no character, which is the whole rule.
 *
 * This used to set every character's world too, back when it was a "Set all" button. Under a toggle
 * that is the worst thing it could do: flipping to Reboot to look at your Reboot characters would
 * convert your Interactive ones on the way, silently, and their parties would stop being able to
 * sell what they had already sold. Pinned by a test.
 */
internal fun setActiveWorld(
    userId: String,
    world: String,
) {
    Users.update({ Users.id eq userId }) { it[worldType] = world }
}
