package com.sharpeyes.api.friends

import kotlinx.serialization.Serializable

@Serializable
data class SendFriendRequest(
    val username: String,
)

/** Somebody else's account, as the Social page shows it. */
@Serializable
data class FriendView(
    /** The request's id on a request, the person's id on a friend. */
    val id: String,
    val username: String?,
    val name: String?,
    val spriteImgUrl: String?,
    /** Their current Discord avatar. See imagesOf. */
    val image: String? = null,
)

/** Who a typed Discord username is, for the preview beside the box. */
@Serializable
data class DiscordLookupResponse(
    val username: String,
    val image: String?,
    /** Their main character, which is how the bell will name them. */
    val name: String?,
    val spriteImgUrl: String?,
    /** The name is your own. */
    val you: Boolean,
)

/** Null when nobody here has the name. */
@Serializable
data class DiscordLookupAnswer(
    val found: DiscordLookupResponse?,
)

@Serializable
data class SocialResponse(
    /** Yours, so you can tell a friend what to type. Null until you sign in with Discord. */
    val username: String?,
    val friends: List<FriendView>,
    val outgoing: List<FriendView>,
)
