package com.maplestorage.backend.bosses

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.services.DetectedBossClear
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Exercises the write and the read behind /api/bosses/clears against a real Postgres, because the
// things most likely to be wrong are things only a database answers: whether the per-cadence OR
// is valid SQL, whether the upsert actually replaces rather than duplicating, and whether the
// ownership filter really excludes another user's characters.
class BossClearsTest {
    private val userOneId = "user_test_bosses_1"
    private val userTwoId = "user_test_bosses_2"

    // A Thursday (GMS weekly reset) and the Saturday inside that same week. Verified against the
    // calendar, not assumed. See BossPeriodTest.
    private val resetDay = Instant.parse("2026-07-16T00:00:00Z")
    private val midWeek = Instant.parse("2026-07-18T12:00:00Z")

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
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            val ids =
                Characters
                    .selectAll()
                    .where { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
                    .map { it[Characters.id] }
            // boss_clear references both characters and screenshots, so it goes first, then the
            // screenshots those clears pointed at, then the characters.
            ids.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            Screenshots.deleteWhere { (Screenshots.userId eq userOneId) or (Screenshots.userId eq userTwoId) }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
    ): Uuid {
        // characters.user_id is a real FK, so the user has to exist before the character does.
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        val nextPosition =
            Characters
                .selectAll()
                .where { Characters.userId eq userId }
                .count()
                .toInt()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = nextPosition
        }
        return id
    }

    // boss_clear.source_screenshot_id is a real FK, so a made-up id will not insert. Every clear
    // is attributed to the capture it came from, which is the point of the column.
    private fun addScreenshot(userId: String): Uuid {
        val id = Uuid.random()
        Screenshots.insert {
            it[Screenshots.id] = id
            it[Screenshots.userId] = userId
            it[uploadedAt] = Clock.System.now()
            it[parseStatus] = "SUCCESS"
            it[type] = "PLANNER"
        }
        return id
    }

    @Test
    fun `a planner read comes back as that character's clears`() =
        transaction {
            val character = addCharacter(userOneId, "Reader")
            upsertBossClears(
                character,
                listOf(DetectedBossClear("lotus", true), DetectedBossClear("damien", false)),
                addScreenshot(userOneId),
                midWeek,
            )

            val clears = currentBossClearsFor(userOneId, midWeek).getValue(character.toString())
            assertEquals(listOf("lotus", "damien"), clears.map { it.bossKey })
            assertEquals(listOf(true, false), clears.map { it.cleared })
            // Pending rows are stored too: without them "not cleared" and "never seen" would be
            // the same absence. See V10__boss_clear.sql.
            assertEquals("2026-07-16", clears.first().periodStart)
        }

    @Test
    fun `a second capture in the same period replaces the first rather than duplicating it`() =
        transaction {
            val character = addCharacter(userOneId, "Repeat")
            upsertBossClears(character, listOf(DetectedBossClear("lotus", false)), addScreenshot(userOneId), resetDay)
            upsertBossClears(character, listOf(DetectedBossClear("lotus", true)), addScreenshot(userOneId), midWeek)

            val clears = currentBossClearsFor(userOneId, midWeek).getValue(character.toString())
            assertEquals(1, clears.size, "the same boss in the same period must be one row")
            assertTrue(clears.single().cleared, "the later capture wins")
        }

    @Test
    fun `bosses on different cadences are all current at the same instant`() =
        transaction {
            // The bug this guards: filtering on ONE period_start. midWeek is a Saturday, so the
            // weekly period started on the 16th and the monthly one on the 1st. A single date
            // would return one cadence and silently drop the other.
            //
            // Two cadences, not three: the dailies were dropped from the catalog (see
            // V14__drop_daily_bosses.sql), so there is no DAILY boss to key a clear on. The guard
            // does not weaken, it needs only that the periods differ. BossPeriodTest still covers
            // DAILY itself, which BossPeriod keeps resolving.
            val character = addCharacter(userOneId, "Mixed")
            upsertBossClears(
                character,
                listOf(
                    DetectedBossClear("lotus", true), // WEEKLY
                    DetectedBossClear("black-mage", false), // MONTHLY
                ),
                addScreenshot(userOneId),
                midWeek,
            )

            val clears = currentBossClearsFor(userOneId, midWeek).getValue(character.toString())
            assertEquals(setOf("lotus", "black-mage"), clears.map { it.bossKey }.toSet())
            val byKey = clears.associateBy { it.bossKey }
            assertEquals("2026-07-16", byKey.getValue("lotus").periodStart)
            assertEquals("2026-07-01", byKey.getValue("black-mage").periodStart)
        }

    @Test
    fun `last week's clears are not this week's`() =
        transaction {
            // Reset is a query boundary, not a job. Nothing deletes the old row; the new period
            // simply does not select it, and the matrix reads pending again.
            val character = addCharacter(userOneId, "Stale")
            val lastWeek = Instant.parse("2026-07-09T12:00:00Z")
            upsertBossClears(character, listOf(DetectedBossClear("lotus", true)), addScreenshot(userOneId), lastWeek)

            assertTrue(currentBossClearsFor(userOneId, midWeek).isEmpty(), "a new week starts empty")
            // The row is still there, filed against the week it belongs to.
            assertEquals(
                listOf("lotus"),
                currentBossClearsFor(userOneId, lastWeek).getValue(character.toString()).map { it.bossKey },
            )
        }

    @Test
    fun `one user's clears never reach another's matrix`() =
        transaction {
            val mine = addCharacter(userOneId, "Mine")
            val theirs = addCharacter(userTwoId, "Theirs")
            upsertBossClears(mine, listOf(DetectedBossClear("lotus", true)), addScreenshot(userOneId), midWeek)
            upsertBossClears(theirs, listOf(DetectedBossClear("damien", true)), addScreenshot(userTwoId), midWeek)

            val forUserOne = currentBossClearsFor(userOneId, midWeek)
            assertEquals(setOf(mine.toString()), forUserOne.keys)
            assertEquals(listOf("lotus"), forUserOne.getValue(mine.toString()).map { it.bossKey })
        }

    @Test
    fun `clears come back in the catalog's progression order`() =
        transaction {
            val character = addCharacter(userOneId, "Ordered")
            // Handed over backwards on purpose: the order must come from the catalog, not from
            // whatever order the reader happened to emit rows in.
            upsertBossClears(
                character,
                listOf(
                    DetectedBossClear("kaling", false),
                    DetectedBossClear("lucid", true),
                    DetectedBossClear("lotus", true),
                ),
                addScreenshot(userOneId),
                midWeek,
            )

            val clears = currentBossClearsFor(userOneId, midWeek).getValue(character.toString())
            assertEquals(listOf("lotus", "lucid", "kaling"), clears.map { it.bossKey })
        }

    @Test
    fun `a past week comes back as the week it was captured in, not as now`() =
        transaction {
            val character = addCharacter(userOneId, "Historian")
            val lastWeek = Instant.parse("2026-07-09T12:00:00Z")
            upsertBossClears(character, listOf(DetectedBossClear("lotus", true)), addScreenshot(userOneId), lastWeek)
            upsertBossClears(character, listOf(DetectedBossClear("damien", true)), addScreenshot(userOneId), midWeek)

            val previous = weeklyClearsFor(userOneId, LocalDate(2026, 7, 9)).getValue(character.toString())
            assertEquals(listOf("lotus"), previous.map { it.bossKey }, "this week's clear must not leak back")
            val current = weeklyClearsFor(userOneId, LocalDate(2026, 7, 16)).getValue(character.toString())
            assertEquals(listOf("damien"), current.map { it.bossKey })
        }

    @Test
    fun `a past week answers for weekly bosses only`() =
        transaction {
            // Not a shortcut: seven daily periods sit inside one week, so a daily boss has no single
            // answer for it, and a week can straddle two months. See weeklyClearsFor.
            //
            // The MONTHLY boss carries the test on its own now. There is no DAILY boss left to key a
            // clear on (#111 dropped them), and upserting one throws rather than being ignored.
            val character = addCharacter(userOneId, "Cadences")
            upsertBossClears(
                character,
                listOf(
                    DetectedBossClear("lotus", true), // WEEKLY
                    DetectedBossClear("black-mage", true), // MONTHLY
                ),
                addScreenshot(userOneId),
                midWeek,
            )

            val week = weeklyClearsFor(userOneId, LocalDate(2026, 7, 16)).getValue(character.toString())
            assertEquals(listOf("lotus"), week.map { it.bossKey })
        }

    @Test
    fun `a week nobody captured is empty rather than borrowed from a neighbour`() =
        transaction {
            val character = addCharacter(userOneId, "Gap")
            upsertBossClears(character, listOf(DetectedBossClear("lotus", true)), addScreenshot(userOneId), midWeek)

            assertTrue(weeklyClearsFor(userOneId, LocalDate(2026, 7, 9)).isEmpty())
        }

    @Test
    fun `the earliest week bounds the back arrow`() =
        transaction {
            val character = addCharacter(userOneId, "Bounded")
            upsertBossClears(
                character,
                listOf(DetectedBossClear("lotus", true)),
                addScreenshot(userOneId),
                Instant.parse("2026-06-25T12:00:00Z"),
            )
            upsertBossClears(character, listOf(DetectedBossClear("damien", true)), addScreenshot(userOneId), midWeek)

            assertEquals(LocalDate(2026, 6, 25), earliestWeekStartFor(userOneId))
        }

    @Test
    fun `a user with no clears has no history to step into`() =
        transaction {
            addCharacter(userOneId, "Fresh")
            assertNull(earliestWeekStartFor(userOneId))
        }

    @Test
    fun `another user's history is neither readable nor counted as mine`() =
        transaction {
            val theirs = addCharacter(userTwoId, "Theirs")
            addCharacter(userOneId, "Mine")
            upsertBossClears(theirs, listOf(DetectedBossClear("lotus", true)), addScreenshot(userTwoId), midWeek)

            assertTrue(weeklyClearsFor(userOneId, LocalDate(2026, 7, 16)).isEmpty())
            assertNull(earliestWeekStartFor(userOneId), "their week must not bound my back arrow")
        }

    @Test
    fun `a boss key the catalog does not know is loud`() =
        transaction {
            // The silent version of this dropped every token when the parser changed its key
            // format and no test noticed. See upsertTokenCounts.
            val character = addCharacter(userOneId, "Drifted")
            assertFailsWith<IllegalStateException> {
                upsertBossClears(
                    character,
                    listOf(DetectedBossClear("not-a-boss", true)),
                    addScreenshot(userOneId),
                    midWeek,
                )
            }
        }
}
