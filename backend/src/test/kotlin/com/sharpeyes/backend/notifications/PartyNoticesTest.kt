package com.sharpeyes.backend.notifications

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.events.ACTOR
import com.sharpeyes.backend.users.ensureUser
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** Which way a shared book's entry reads on the other side's bell. See noticeLedger. */
class PartyNoticesTest {
    private val owner = "user_test_notice_owner"
    private val member = "user_test_notice_member"
    private val person = Uuid.random()

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
        transaction {
            ensureUser(owner, "$owner@example.com")
            ensureUser(member, "$member@example.com")
            val now = Clock.System.now()
            Person.insert {
                it[id] = person
                it[userId] = owner
                it[name] = "Bro"
                it[pinned] = false
                it[linkedUserId] = member
                it[createdAt] = now
                it[updatedAt] = now
            }
        }
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            Notification.deleteWhere { Notification.userId inList listOf(owner, member) }
            Person.deleteWhere { Person.id eq person }
        }
    }

    /** Whether the one entry [reader] got says the money runs to them. The writer gets none. */
    private fun told(
        actor: String,
        amount: Long,
        reader: String,
    ): Boolean =
        transaction {
            ACTOR.set(actor)
            try {
                noticeLedger(person, "debt", amount, null)
            } finally {
                ACTOR.remove()
            }
            assertEquals(0, notificationsFor(actor).notifications.size)
            notificationsFor(reader)
                .notifications
                .single()
                .payload.jsonObject["toYou"]!!
                .jsonPrimitive.boolean
        }

    @Test
    fun `the owner's debt against the member tells the member they owe`() {
        assertFalse(told(actor = owner, amount = 5, reader = member))
    }

    @Test
    fun `the member's entry of what the owner owes them tells the owner they owe`() {
        assertFalse(told(actor = member, amount = -5, reader = owner))
    }

    @Test
    fun `the member owing the owner tells the owner it is theirs`() {
        assertTrue(told(actor = member, amount = 5, reader = owner))
    }
}
