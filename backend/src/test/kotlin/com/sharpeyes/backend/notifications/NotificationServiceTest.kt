package com.sharpeyes.backend.notifications

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.users.ensureUser
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.time.Clock
import kotlin.uuid.Uuid

class NotificationServiceTest {
    private val me = "user_test_notify_me"
    private val other = "user_test_notify_other"

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(
            url = jdbcUrl,
            driver = "org.postgresql.Driver",
            user = Env.dbUsername,
            password = Env.dbPassword,
        )
        cleanUp()
    }

    @AfterTest
    fun cleanUp() {
        transaction { Notification.deleteWhere { Notification.userId inList listOf(me, other) } }
    }

    @Test
    fun `a kind's payload comes back as written, and reading clears the count but not the list`() {
        transaction {
            ensureUser(me, "$me@example.com")
            val payload = buildJsonObject { put("amount", JsonPrimitive(48_000_000_000)) }
            notify(me, "SALE", Clock.System.now(), payload = payload)

            assertEquals(1, notificationsFor(me).unread)
            assertEquals(payload, notificationsFor(me).notifications.single().payload)

            markAllRead(me, Clock.System.now())

            assertEquals(0, notificationsFor(me).unread)
            assertEquals(true, notificationsFor(me).notifications.single().read)
        }
    }

    @Test
    fun `only your own can be dismissed`() {
        transaction {
            ensureUser(me, "$me@example.com")
            ensureUser(other, "$other@example.com")
            notify(other, "SALE", Clock.System.now())
            val theirs = Uuid.parse(notificationsFor(other).notifications.single().id)

            assertFalse(dismiss(me, theirs))
            assertEquals(1, notificationsFor(other).notifications.size)
        }
    }
}
