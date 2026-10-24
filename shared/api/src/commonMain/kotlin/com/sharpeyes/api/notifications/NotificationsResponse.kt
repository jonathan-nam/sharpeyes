package com.sharpeyes.api.notifications

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Who caused a notification, as their main character. */
@Serializable
data class Actor(
    val name: String?,
    val username: String?,
    val spriteImgUrl: String?,
    /** Their current Discord avatar. See imagesOf. */
    val image: String? = null,
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
)

/** GET /api/notifications. `unread` is the bell's count, across all of them and not just those listed. */
@Serializable
data class NotificationsResponse(
    val unread: Int,
    val notifications: List<NotificationView>,
)
