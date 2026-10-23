package com.sharpeyes.backend.planner

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.PartyPlannerDraft
import com.sharpeyes.backend.db.Users
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/** The Party Planner's saved settings (V93): one per account, replaced whole, read back as written. */
class PlannerDraftTest {
    private val userId = "user_test_planner_draft"
    private val other = "user_test_planner_draft_other"

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
            for (id in listOf(userId, other)) {
                Users.insertIgnore {
                    it[Users.id] = id
                    it[email] = "$id@example.com"
                    it[createdAt] = Clock.System.now()
                }
            }
        }
    }

    @AfterTest
    fun cleanUp() {
        // Held in a local: inside deleteWhere {} a bare `userId` binds to the column. See PartyLootTest.
        val ids = listOf(userId, other)
        transaction {
            PartyPlannerDraft.deleteWhere { PartyPlannerDraft.userId inList ids }
            Users.deleteWhere { Users.id inList ids }
        }
    }

    private fun draft(minutes: Int) = buildJsonObject { put("maxMinutes", JsonPrimitive(minutes)) }

    @Test
    fun `an account that never saved reads as nothing saved`() {
        val saved = transaction { savedPlannerFor(userId) }
        assertNull(saved.draft)
        assertNull(saved.savedAt)
    }

    @Test
    fun `a second save replaces the first, and leaves other accounts alone`() {
        // Whole seconds: Postgres keeps microseconds, so a nanosecond clock reading would not round-trip.
        val first = Instant.parse("2026-10-23T12:00:00Z")
        transaction {
            savePlannerFor(userId, draft(30), first)
            savePlannerFor(other, draft(15), first)
            savePlannerFor(userId, draft(20), first + 5.minutes)
        }
        val mine = transaction { savedPlannerFor(userId) }
        assertEquals(draft(20), mine.draft)
        assertEquals((first + 5.minutes).toString(), mine.savedAt)
        assertEquals(draft(15), transaction { savedPlannerFor(other) }.draft)
    }
}
