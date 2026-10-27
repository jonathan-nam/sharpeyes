package com.sharpeyes.api.notifications

import com.sharpeyes.api.AbsentOnCachedPayload
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Who caused a notification, as their main character. */
@Serializable
data class Actor(
    val name: String?,
    val username: String?,
    val spriteImgUrl: String?,
    /** Their current Discord avatar. See imagesOf. */
    @AbsentOnCachedPayload
    val image: String? = null,
)

/**
 * A button on a notification, described by the server so a client draws it without knowing the
 * kind. A link has [href]; an answer has [method] and [path], an API call.
 */
@Serializable
data class NotificationAction(
    val label: String,
    val primary: Boolean = false,
    val href: String? = null,
    val method: String? = null,
    val path: String? = null,
)

@Serializable
data class NotificationView(
    val id: String,
    /** One of NotificationKind. */
    val kind: String,
    val subjectId: String?,
    val createdAt: String,
    val read: Boolean,
    val actor: Actor?,
    /** Whatever else the kind needs, as the feature that raised it wrote it. */
    val payload: JsonElement,
    /**
     * The sentence, written by the server, so every client and a push notification say the same
     * thing. Null for a kind the client still writes itself.
     */
    @AbsentOnCachedPayload
    val text: String? = null,
    @AbsentOnCachedPayload
    val actions: List<NotificationAction> = emptyList(),
)

/** GET /api/notifications. `unread` is the bell's count, across all of them and not just those listed. */
@Serializable
data class NotificationsResponse(
    val unread: Int,
    val notifications: List<NotificationView>,
)
