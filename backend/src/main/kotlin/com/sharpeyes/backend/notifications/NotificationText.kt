package com.sharpeyes.backend.notifications

import com.sharpeyes.api.bosses.bossLabel
import com.sharpeyes.api.notifications.NotificationAction
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

// What a notification says, and its buttons, written here so the web, the native apps and a push
// notification say the same thing and a new kind needs no client release. Kinds not listed are still
// drawn by the client (frontend/components/notification-kinds.tsx) until they move here.
//
// Privacy is the payload's job, not this file's: a note to somebody who is not a friend of a party's
// owner carries nothing about that party, so there is nothing here to leave out.

/** The sentence and buttons for [kind], or null for a kind the client still writes. */
internal fun rendered(
    kind: String,
    subjectId: String?,
    payload: JsonElement,
    who: String,
): Pair<String, List<NotificationAction>>? {
    val p = payload as? JsonObject ?: return null
    val str = { key: String -> (p[key] as? JsonPrimitive)?.content.orEmpty() }
    val party = { "${str("leader")}'s ${bossLabel(str("boss"), str("difficulty").ifEmpty { null })}" }
    val viewParty = NotificationAction("View Party", href = "/bosses/parties/${str("partyId")}")
    return when (kind) {
        NotificationKind.PARTY_ADDED -> {
            val week = (p["week"] as? JsonPrimitive)?.booleanOrNull == true
            Pair(
                "$who added ${str("character")} to ${party()}${if (week) " for this week" else ""}",
                listOf(viewParty),
            )
        }
        NotificationKind.PARTY_INVITE ->
            invite(
                subjectId,
                who,
                str("character"),
                party(),
                str("fromLeader"),
                str("boss"),
            )
        NotificationKind.CHARACTER_LEFT -> {
            val bosses = (p["bosses"]?.jsonArray ?: emptyList()).map { it.jsonPrimitive.content }
            val more = bosses.size - 1
            val tail = if (more > 0) " and $more other ${if (more == 1) "boss" else "bosses"}" else ""
            Pair(
                "${str("character")} has left ${bosses.firstOrNull().orEmpty()}$tail.",
                listOf(NotificationAction("View Parties", href = "/bosses/parties")),
            )
        }
        NotificationKind.CHARACTER_AWAY ->
            Pair("${str("character")} is running ${str("boss")} elsewhere this week.", listOf(viewParty))
        else -> null
    }
}

/** An ask to move a character here from another party (`fromLeader`), or an invite from before asks. */
private fun invite(
    subjectId: String?,
    who: String,
    character: String,
    party: String,
    fromLeader: String,
    boss: String,
): Pair<String, List<NotificationAction>> {
    val path = "/api/party-invites/$subjectId"
    val yes = { label: String -> NotificationAction(label, primary = true, method = "POST", path = "$path/accept") }
    val no = { label: String -> NotificationAction(label, method = "DELETE", path = path) }
    return if (fromLeader.isEmpty()) {
        Pair("$who invited $character to $party", listOf(yes("Accept"), no("Decline")))
    } else {
        Pair(
            "$who wants $character in $party. Moving takes it out of $fromLeader's $boss.",
            listOf(yes("Move"), no("Stay")),
        )
    }
}
