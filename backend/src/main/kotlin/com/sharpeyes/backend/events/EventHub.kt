package com.sharpeyes.backend.events

import com.sharpeyes.backend.config.Env
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import org.postgresql.PGConnection
import org.slf4j.LoggerFactory
import java.sql.DriverManager
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration.Companion.seconds

// The browsers connected to THIS replica, and the LISTEN that feeds them. One connection of its own,
// outside the pool: it waits on the socket for as long as the replica runs, and a pooled one held
// that way is one of five a request can no longer have.

private val log = LoggerFactory.getLogger("EventHub")

/** How long the LISTEN waits for a notification before checking it is still meant to run. */
private const val POLL_MS = 10_000

/** Per browser. A page that falls this far behind only needs to know it should read again. */
private const val BUFFER = 16

internal object EventHub {
    private val listeners = ConcurrentHashMap<String, MutableSet<Channel<Event>>>()

    fun subscribe(userId: String): Channel<Event> {
        val channel = Channel<Event>(BUFFER)
        listeners.computeIfAbsent(userId) { ConcurrentHashMap.newKeySet() }.add(channel)
        return channel
    }

    fun unsubscribe(
        userId: String,
        channel: Channel<Event>,
    ) {
        listeners[userId]?.remove(channel)
        channel.close()
    }

    fun deliver(event: Event) {
        for (user in event.users) listeners[user]?.forEach { it.trySend(event) }
    }
}

/** Starts the LISTEN, reconnecting after a failure, for as long as the application runs. */
fun Application.startEventHub() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    monitor.subscribe(ApplicationStopped) { scope.cancel() }
    scope.launch {
        val url = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        while (isActive) {
            runCatching {
                DriverManager.getConnection(url, Env.dbUsername, Env.dbPassword).use { connection ->
                    connection.createStatement().use { it.execute("LISTEN $CHANNEL") }
                    val pg = connection.unwrap(PGConnection::class.java)
                    while (isActive) {
                        pg.getNotifications(POLL_MS)?.forEach { note ->
                            runCatching { Json.decodeFromString(Event.serializer(), note.parameter) }
                                .onSuccess(EventHub::deliver)
                        }
                    }
                }
            }.onFailure { log.warn("live events lost their LISTEN, retrying", it) }
            delay(5.seconds)
        }
    }
}
