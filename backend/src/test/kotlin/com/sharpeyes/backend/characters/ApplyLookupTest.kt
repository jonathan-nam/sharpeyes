package com.sharpeyes.backend.characters

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.services.NexonLookupResult
import com.sharpeyes.backend.users.GmsWorld
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * What a refresh writes, and why the world is part of it.
 *
 * There is no longer a control for setting a character's world by hand, on the grounds that a world
 * nobody checked looks exactly like one that was: six characters in the dev database sat recorded as
 * Heroic while playing in Scania, and every screen agreed with them.
 *
 * That removal is only safe because of the first test here. If a refresh recorded what it found
 * without acting on it, a character in the wrong world would be stuck there for good, and the app
 * would have gone from a wrong answer you could fix to a wrong answer you could not.
 */
class ApplyLookupTest {
    private val userId = "user_test_lookup_1"
    private val characterId = Uuid.random()

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
        // Held in a local: inside deleteWhere {} the table is the receiver, so a bare `userId` binds
        // to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owner = userId
        transaction { Characters.deleteWhere { Characters.userId eq owner } }
    }

    /** A character recorded in [world] under [name], which is where the wrong answers start. */
    private fun character(
        world: String,
        name: String = "tidelark",
    ) {
        val owner = userId
        val now = Clock.System.now()
        ensureUser(owner, "$owner@example.com")
        Characters.insert {
            it[Characters.id] = characterId
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
    }

    private fun found(
        world: GmsWorld?,
        name: String = "tidelark",
    ) = NexonLookupResult(
        name = name,
        level = 296,
        jobName = "Night Lord",
        spriteImgUrl = "https://msavatar1.nexon.net/x.png",
        world = world,
    )

    private fun stored() =
        Characters
            .selectAll()
            .where { Characters.id eq characterId }
            .single()

    @Test
    fun `a refresh corrects a world that was recorded wrong`() {
        transaction {
            // Exactly the shape of the real bug: recorded Heroic, actually in Scania.
            character(WORLD_HEROIC)

            applyLookup(characterId, userId, found(GmsWorld.SCANIA), Clock.System.now())

            val row = stored()
            assertEquals("Scania", row[Characters.worldName])
            // The category follows the world. Leaving this behind is what would keep offering a
            // price box on drops that cannot be sold, or take one away from drops that can.
            assertEquals(WORLD_INTERACTIVE, row[Characters.worldType])
        }
    }

    @Test
    fun `a world this build does not know leaves the last answer alone`() {
        transaction {
            character(WORLD_INTERACTIVE)
            applyLookup(characterId, userId, found(GmsWorld.SCANIA), Clock.System.now())

            // Null is "no world in the enum answered", not "this character has stopped having one".
            // Blanking it here would throw away the best answer anybody has for the sake of a
            // lookup that told us nothing.
            applyLookup(characterId, userId, found(null), Clock.System.now())

            val row = stored()
            assertEquals("Scania", row[Characters.worldName])
            assertEquals(WORLD_INTERACTIVE, row[Characters.worldType])
        }
    }

    @Test
    fun `the rest of the lookup lands too`() {
        transaction {
            character(WORLD_INTERACTIVE)
            assertNull(stored()[Characters.level])

            applyLookup(characterId, userId, found(GmsWorld.SCANIA), Clock.System.now())

            val row = stored()
            assertEquals(296, row[Characters.level])
            assertEquals("Night Lord", row[Characters.jobName])
            assertEquals("https://msavatar1.nexon.net/x.png", row[Characters.spriteImgUrl])
        }
    }

    @Test
    fun `a refresh corrects the capitalisation of a name`() {
        transaction {
            // The lookup matches case-insensitively, so this is a name that was typed rather than
            // read, and a refresh is the only thing that can tell the two apart.
            character(WORLD_INTERACTIVE, name = "Marrowwind")

            applyLookup(characterId, userId, found(GmsWorld.SCANIA, name = "MarrowWind"), Clock.System.now())

            assertEquals("MarrowWind", stored()[Characters.name])
        }
    }

    @Test
    fun `it only ever touches the caller's own character`() {
        transaction {
            character(WORLD_HEROIC)

            applyLookup(characterId, "somebody_else", found(GmsWorld.SCANIA), Clock.System.now())

            // The ownership predicate is half of a two-column WHERE, so a refresh that matched on
            // the id alone would let one account rewrite another's character.
            assertEquals(WORLD_HEROIC, stored()[Characters.worldType])
            assertNull(stored()[Characters.worldName])
        }
    }
}
