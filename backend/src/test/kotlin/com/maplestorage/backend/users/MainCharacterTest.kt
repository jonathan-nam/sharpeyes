package com.maplestorage.backend.users

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.sprites.spriteProxyPath
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * The account avatar's character (V66), moved out of Clerk's unsafeMetadata.
 *
 * Two rules are worth pinning. The sprite is joined and never stored, because Clerk's stored copy
 * went stale the moment a character changed outfit. And the id has to be one of yours, because an
 * unchecked one would draw a stranger's sprite in your own header.
 */
class MainCharacterTest {
    private val userId = "user_test_main_character"
    private val stranger = "user_test_main_character_other"

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
        // Held in locals: inside deleteWhere {} the table is the receiver, so a bare `userId` binds
        // to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owner = userId
        val other = stranger
        transaction {
            Users.update({ Users.id eq owner }) { it[mainCharacterId] = null }
            Users.update({ Users.id eq other }) { it[mainCharacterId] = null }
            Characters.deleteWhere { Characters.userId eq owner }
            Characters.deleteWhere { Characters.userId eq other }
        }
    }

    private fun character(
        owner: String,
        name: String,
        sprite: String?,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[Characters.spriteImgUrl] = sprite
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    @Test
    fun `the sprite follows the character's current outfit, because it is joined and not stored`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val before = "https://msavatar1.nexon.net/Character/BEFORE.png"
            val id = character(userId, "mechyfechy", before)

            assertTrue(setMainCharacter(userId, id))
            assertEquals(spriteProxyPath(before), settingsFor(userId).mainCharacterSprite)

            // What broke the Clerk copy. The proxy path is a hash of the source URL, so a new
            // outfit left the stored path pointing at a hash nothing serves.
            val after = "https://msavatar1.nexon.net/Character/AFTER.png"
            Characters.update({ Characters.id eq id }) { it[spriteImgUrl] = after }

            assertEquals(spriteProxyPath(after), settingsFor(userId).mainCharacterSprite)
        }
    }

    @Test
    fun `a character you do not own is refused and changes nothing`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            ensureUser(stranger, "$stranger@example.com")
            val mine = character(userId, "mechyfechy", "https://msavatar1.nexon.net/Character/A.png")
            val theirs = character(stranger, "Rune", "https://msavatar1.nexon.net/Character/B.png")

            assertTrue(setMainCharacter(userId, mine))
            assertFalse(setMainCharacter(userId, theirs))

            // Not merely refused: the main it already had is still the one it had.
            assertEquals(mine.toString(), settingsFor(userId).mainCharacterId)
        }
    }

    @Test
    fun `null clears the choice`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val id = character(userId, "mechyfechy", "https://msavatar1.nexon.net/Character/A.png")

            assertTrue(setMainCharacter(userId, id))
            assertTrue(setMainCharacter(userId, null))

            assertNull(settingsFor(userId).mainCharacterId)
            assertNull(settingsFor(userId).mainCharacterSprite)
        }
    }

    @Test
    fun `deleting your main clears it rather than blocking the delete`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val id = character(userId, "mechyfechy", "https://msavatar1.nexon.net/Character/A.png")
            assertTrue(setMainCharacter(userId, id))

            // The FK is ON DELETE SET NULL. Left as the default it would be RESTRICT, and deleting
            // your main would fail with a constraint violation the user has no way to read.
            Characters.deleteWhere { Characters.id eq id }

            assertNull(settingsFor(userId).mainCharacterId)
        }
    }

    @Test
    fun `a character with no sprite yet is a main with no sprite, not an error`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val id = character(userId, "Unranked", null)

            assertTrue(setMainCharacter(userId, id))
            assertEquals(id.toString(), settingsFor(userId).mainCharacterId)
            assertNull(settingsFor(userId).mainCharacterSprite)
        }
    }
}
