package com.sharpeyes.backend.users

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Users
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * The world mode, and the two things every screen reads off it.
 *
 * `worldType` is which world the site is answering for, and `trades` follows from it. An account
 * holds characters in both, so the mode is a lens: the alternative was summing both worlds into one
 * figure and asking "does anybody here trade", which cannot answer what a meso total is a total OF.
 *
 * The rule the toggle rests on is the last test: changing the mode moves nothing.
 */
class AccountWorldTest {
    private val userId = "user_test_world_1"

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
        // Held in a local: inside deleteWhere {} the table is the receiver, so a bare `userId`
        // binds to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owner = userId
        transaction {
            Characters.deleteWhere { Characters.userId eq owner }
            Users.update({ Users.id eq owner }) { it[worldType] = WORLD_INTERACTIVE }
        }
    }

    private fun character(
        name: String,
        world: String,
    ) {
        val owner = userId
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = Uuid.random()
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[Characters.worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
    }

    /** The same call the PUT makes, so what the toggle actually does is what is under test. */
    private fun mode(world: String) = setActiveWorld(userId, world)

    @Test
    fun `trades follows the world being shown, not the characters in the other one`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            character("Rune", WORLD_HEROIC)
            character("mechobotto", WORLD_INTERACTIVE)

            mode(WORLD_INTERACTIVE)
            assertTrue(settingsFor(userId).trades)

            // The Interactive character still exists and still earns. It is not what this screen is
            // answering for, and a meso figure drawn here would be its earnings under a heading
            // that says Heroic.
            mode(WORLD_HEROIC)
            assertFalse(settingsFor(userId).trades)
        }
    }

    @Test
    fun `an account with no characters answers for the world it is looking at`() {
        transaction {
            ensureUser(userId, "$userId@example.com")

            assertTrue(settingsFor(userId).trades)
            assertEquals(0, settingsFor(userId).otherWorldCharacters)
        }
    }

    @Test
    fun `the other world's characters are counted, so an empty list is not read as an empty account`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            character("Rune", WORLD_HEROIC)
            character("Steve", WORLD_HEROIC)
            character("mechobotto", WORLD_INTERACTIVE)

            mode(WORLD_INTERACTIVE)
            assertEquals(2, settingsFor(userId).otherWorldCharacters)

            mode(WORLD_HEROIC)
            assertEquals(1, settingsFor(userId).otherWorldCharacters)
        }
    }

    @Test
    fun `changing the mode moves no character`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            character("Rune", WORLD_HEROIC)
            character("mechobotto", WORLD_INTERACTIVE)

            // What the old "Set all" control did, and what a toggle must never do: flipping to
            // Heroic to look at your Heroic characters used to convert the Interactive ones on the
            // way, silently, and their parties stopped being able to sell what they had sold.
            mode(WORLD_HEROIC)

            val worlds =
                Characters
                    .selectAll()
                    .where { Characters.userId eq userId }
                    .map { it[Characters.name] to it[Characters.worldType] }
                    .toMap()
            assertEquals(WORLD_HEROIC, worlds["Rune"])
            assertEquals(WORLD_INTERACTIVE, worlds["mechobotto"])
        }
    }
}
