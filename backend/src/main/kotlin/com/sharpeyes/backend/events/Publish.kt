package com.sharpeyes.backend.events

import com.sharpeyes.backend.parties.audienceOf
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.jdbc.transactions.TransactionManager
import kotlin.uuid.Uuid

// How any write tells other people's open pages that something moved. Postgres NOTIFY, sent inside
// the writer's transaction: it is delivered on COMMIT and dropped on rollback, so a page never reads
// back ahead of the data and never hears about a write that did not happen. Every replica LISTENs
// (EventHub.kt), so it reaches a browser connected to either.

internal const val CHANNEL = "sharpeyes_events"

@Serializable
internal data class Event(
    val users: List<String>,
    val topic: String,
)

/** Tells [users]' open pages that [topic] changed. Inside a transaction. */
internal fun publish(
    users: Collection<String>,
    topic: String,
) {
    if (users.isEmpty()) return
    val payload = Json.encodeToString(Event.serializer(), Event(users.distinct(), topic))
    TransactionManager.current().exec("SELECT pg_notify(?, ?)", listOf(textArg(CHANNEL), textArg(payload)))
}

/** Tells everybody [partyId] reaches, its owner included. See audienceOf. */
internal fun publishToParty(
    partyId: Uuid,
    topic: String,
) = publish(audienceOf(partyId), topic)

private fun textArg(value: String) =
    org.jetbrains.exposed.v1.core
        .TextColumnType() to value
