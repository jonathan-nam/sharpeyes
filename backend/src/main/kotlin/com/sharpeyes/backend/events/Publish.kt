package com.sharpeyes.backend.events

import com.sharpeyes.backend.parties.audienceOf
import com.sharpeyes.backend.parties.imageOf
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.jdbc.transactions.TransactionManager
import kotlin.uuid.Uuid

// How any write tells other people's open pages that something moved. Postgres NOTIFY, sent inside
// the writer's transaction: it is delivered on COMMIT and dropped on rollback, so a page never reads
// back ahead of the data and never hears about a write that did not happen. Every replica LISTENs
// (EventHub.kt), so it reaches a browser connected to either.

internal const val CHANNEL = "sharpeyes_events"

/**
 * What a change touched, as precisely as its writer knows: a party, one of its drops, or a person's
 * Settlement card (the owner's person row, which is the key of both sides' card). Nothing named is a
 * change the page reads again without pointing at anything.
 */
@Serializable
internal data class EventTarget(
    val party: String? = null,
    val loot: String? = null,
    val person: String? = null,
)

@Serializable
internal data class Event(
    val users: List<String>,
    val topic: String,
    /** Who made it, so their own tabs can stay quiet and everybody else's can show their face. */
    val actor: String? = null,
    /** Their Discord avatar. Looked up once here rather than by every browser that hears it. */
    val image: String? = null,
    val target: EventTarget = EventTarget(),
    /** On a PRESENCE event only. The one event that carries what it is about. See Presence.kt. */
    val presence: Presence? = null,
)

/** Tells [users]' open pages that [topic] changed. Inside a transaction. */
internal fun publish(
    users: Collection<String>,
    topic: String,
    target: EventTarget = EventTarget(),
    actor: String? = ACTOR.get(),
) {
    if (users.isEmpty()) return
    val event = Event(users.distinct(), topic, actor, actor?.let(::imageOf), target)
    val payload = Json.encodeToString(Event.serializer(), event)
    TransactionManager.current().exec("SELECT pg_notify(?, ?)", listOf(textArg(CHANNEL), textArg(payload)))
}

/** Tells everybody [partyId] reaches, its owner included. See audienceOf. */
internal fun publishToParty(
    partyId: Uuid,
    topic: String,
    loot: Uuid? = null,
) = publish(audienceOf(partyId), topic, EventTarget(party = partyId.toString(), loot = loot?.toString()))

/** Sends [event] as it is, for a writer that built its own. Inside a transaction. */
internal fun send(event: Event) {
    val payload = Json.encodeToString(Event.serializer(), event)
    TransactionManager.current().exec("SELECT pg_notify(?, ?)", listOf(textArg(CHANNEL), textArg(payload)))
}

private fun textArg(value: String) =
    org.jetbrains.exposed.v1.core
        .TextColumnType() to value
