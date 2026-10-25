package com.sharpeyes.backend.notifications

import com.sharpeyes.api.notifications.Actor
import com.sharpeyes.api.notifications.NotificationView
import com.sharpeyes.api.notifications.NotificationsResponse
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publish
import com.sharpeyes.backend.friends.discordUsernameOf
import com.sharpeyes.backend.friends.faceOf
import com.sharpeyes.backend.parties.imageOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The one way any feature tells somebody something. A feature calls notify() when the thing happens
// and resolve() when it stops needing an answer; how it is listed and drawn is not its business.
// Inside the caller's transaction, so a notification exists exactly when the thing it is about does.

/** The most a bell lists. Older ones are still stored, and still count until read. */
private const val LISTED = 50

internal fun notify(
    userId: String,
    kind: String,
    now: Instant,
    subjectId: Uuid? = null,
    actorId: String? = null,
    payload: JsonElement = JsonObject(emptyMap()),
) {
    Notification.insert {
        it[id] = Uuid.random()
        it[Notification.userId] = userId
        it[Notification.kind] = kind
        it[Notification.subjectId] = subjectId
        it[Notification.actorId] = actorId
        it[Notification.payload] = payload
        it[createdAt] = now
    }
    publish(listOf(userId), Topic.NOTIFICATIONS)
}

/** Clears every notification about [subjectIds], for whoever it was sent to. */
internal fun resolve(
    kind: String,
    subjectIds: Collection<Uuid>,
) {
    if (subjectIds.isEmpty()) return
    val told =
        Notification
            .selectAll()
            .where { (Notification.kind eq kind) and (Notification.subjectId inList subjectIds) }
            .map { it[Notification.userId] }
    publish(told, Topic.NOTIFICATIONS)
    Notification.deleteWhere { (Notification.kind eq kind) and (Notification.subjectId inList subjectIds) }
}

internal fun notificationsFor(userId: String): NotificationsResponse {
    val unread =
        Notification
            .selectAll()
            .where { (Notification.userId eq userId) and Notification.readAt.isNull() }
            .count()
    val listed =
        Notification
            .selectAll()
            .where { Notification.userId eq userId }
            .orderBy(Notification.createdAt, SortOrder.DESC)
            .limit(LISTED)
            .map { row ->
                NotificationView(
                    id = row[Notification.id].toString(),
                    kind = row[Notification.kind],
                    subjectId = row[Notification.subjectId]?.toString(),
                    createdAt = row[Notification.createdAt].toString(),
                    read = row[Notification.readAt] != null,
                    actor = row[Notification.actorId]?.let(::actorOf),
                    payload = row[Notification.payload],
                )
            }
    return NotificationsResponse(unread.toInt(), listed)
}

internal fun markAllRead(
    userId: String,
    now: Instant,
) {
    Notification.update({ (Notification.userId eq userId) and Notification.readAt.isNull() }) {
        it[readAt] = now
    }
}

/** Dismisses one of [userId]'s own. False when there is no such notification of theirs. */
internal fun dismiss(
    userId: String,
    id: Uuid,
): Boolean = Notification.deleteWhere { (Notification.id eq id) and (Notification.userId eq userId) } > 0

private fun actorOf(account: String): Actor {
    val (name, sprite) = faceOf(account)
    return Actor(name, discordUsernameOf(account), sprite, imageOf(account))
}
