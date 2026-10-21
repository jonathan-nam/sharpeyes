package com.sharpeyes.backend.events

import com.sharpeyes.backend.config.Env
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.postgresql.PGConnection
import java.sql.DriverManager
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** What every replica's LISTEN receives from a publish. See Publish.kt. */
class PublishTest {
    private val url = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"

    @BeforeTest
    fun connect() {
        Database.connect(url = url, driver = "org.postgresql.Driver", user = Env.dbUsername, password = Env.dbPassword)
    }

    private fun heard(write: () -> Unit): List<Event> =
        DriverManager.getConnection(url, Env.dbUsername, Env.dbPassword).use { listener ->
            listener.createStatement().use { it.execute("LISTEN $CHANNEL") }
            write()
            listener
                .unwrap(PGConnection::class.java)
                .getNotifications(1_000)
                .orEmpty()
                .map { Json.decodeFromString(Event.serializer(), it.parameter) }
        }

    @Test
    fun `a publish arrives once the write commits`() {
        val events = heard { transaction { publish(listOf("a", "b", "a"), Topic.CLEARS) } }
        assertEquals(listOf(Event(listOf("a", "b"), Topic.CLEARS)), events)
    }

    @Test
    fun `a write that rolls back tells nobody`() {
        val events =
            heard {
                runCatching {
                    transaction {
                        publish(listOf("a"), Topic.CLEARS)
                        error("the write failed")
                    }
                }
            }
        assertEquals(emptyList(), events)
    }
}
