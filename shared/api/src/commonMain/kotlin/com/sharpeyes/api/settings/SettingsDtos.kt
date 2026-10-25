package com.sharpeyes.api.settings

import kotlinx.serialization.Serializable

@Serializable
data class SettingsResponse(
    // INTERACTIVE or HEROIC: the world the site is currently answering for, or null if the account
    // has never said. See activeWorldFor. Null is what the choice screen is drawn on.
    val worldType: String?,
    // Whether anything in the world being shown can change hands. Every meso figure hangs off it.
    //
    // False while unanswered, which costs nothing: an account with no world has no characters to
    // have sold anything, and the screen asking the question is what it gets instead.
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
    // That character's name, for the welcome line. Joined, so a rename follows.
    val mainCharacterName: String? = null,
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
