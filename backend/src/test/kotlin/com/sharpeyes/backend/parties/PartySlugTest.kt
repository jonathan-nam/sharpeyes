package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
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
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * How a config addresses itself in a URL, against a real Postgres.
 *
 * The claim worth a database is that a slug and the party it resolves to cannot come apart. A
 * MapleStory name is unique per world and not per account, so the interesting cases are all about a
 * name two characters share: what it emits, and that asking for it never picks one of the two.
 */
class PartySlugTest {
    private val userOneId = "user_test_slug_1"
    private val userTwoId = "user_test_slug_2"

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
            val owned =
                Characters
                    .selectAll()
                    .where { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
                    .map { it[Characters.id] }
            owned.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            Screenshots.deleteWhere { (Screenshots.userId eq userOneId) or (Screenshots.userId eq userTwoId) }
            Party.deleteWhere { (Party.userId eq userOneId) or (Party.userId eq userTwoId) }
            Person.deleteWhere { (Person.userId eq userOneId) or (Person.userId eq userTwoId) }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
        world: String = WORLD_INTERACTIVE,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun config(
        userId: String,
        characterId: Uuid,
        bossKey: String,
    ): PartyResponse {
        val request = SavePartyRequest(characterId.toString(), bossKey, listOf("CraneBolton"))
        val id = createParty(userId, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now())
        return findParty(id, userId)!!
    }

    @Test
    fun `a config is addressed by its character and its boss`() {
        transaction {
            val mine = addCharacter(userOneId, "MechoBotto")
            val party = config(userOneId, mine, "kalos-the-guardian")

            // Lowercased, because a path that only works in the case it was typed in is not one to
            // put in front of anybody.
            assertEquals("mechobotto/kalos-the-guardian", party.slug)
            assertEquals(party.id, findPartyBySlug(listOf("mechobotto", "kalos-the-guardian"), userOneId)?.id)
        }
    }

    @Test
    fun `a uuid still addresses the config it always did`() {
        transaction {
            val mine = addCharacter(userOneId, "MechoBotto")
            val party = config(userOneId, mine, "kalos-the-guardian")

            // What an older link carries. It resolves to the party, and the party still says its
            // readable name is the one to use.
            assertEquals(party.id, findPartyBySlug(listOf(party.id), userOneId)?.id)
        }
    }

    @Test
    fun `a name two characters share takes its world category in front of it`() {
        transaction {
            val interactive = addCharacter(userOneId, "Rune", WORLD_INTERACTIVE)
            val heroic = addCharacter(userOneId, "Rune", WORLD_HEROIC)
            val onInteractive = config(userOneId, interactive, "kalos-the-guardian")
            val onHeroic = config(userOneId, heroic, "kalos-the-guardian")

            assertEquals("interactive/rune/kalos-the-guardian", onInteractive.slug)
            assertEquals("heroic/rune/kalos-the-guardian", onHeroic.slug)
            // Each names its own, and the bare name names neither.
            assertEquals(
                onInteractive.id,
                findPartyBySlug(listOf("interactive", "rune", "kalos-the-guardian"), userOneId)?.id,
            )
            assertEquals(onHeroic.id, findPartyBySlug(listOf("heroic", "rune", "kalos-the-guardian"), userOneId)?.id)
            assertNull(findPartyBySlug(listOf("rune", "kalos-the-guardian"), userOneId))
        }
    }

    @Test
    fun `a name the world cannot tell apart either is addressed by uuid`() {
        transaction {
            val one = addCharacter(userOneId, "Rune", WORLD_HEROIC)
            val two = addCharacter(userOneId, "Rune", WORLD_HEROIC)
            val onOne = config(userOneId, one, "kalos-the-guardian")
            val onTwo = config(userOneId, two, "baldrix")

            // Two Heroic worlds, one name. The pair is no longer a name for either config, so
            // neither claims it: the id is the only address that cannot be the other party's.
            assertEquals(onOne.id, onOne.slug)
            assertEquals(onTwo.id, onTwo.slug)
            assertNull(findPartyBySlug(listOf("rune", "kalos-the-guardian"), userOneId))
            assertNull(findPartyBySlug(listOf("heroic", "rune", "kalos-the-guardian"), userOneId))
            assertEquals(onOne.id, findPartyBySlug(listOf(onOne.id), userOneId)?.id)
        }
    }

    @Test
    fun `a slug is only ever this account's`() {
        transaction {
            val mine = addCharacter(userOneId, "MechoBotto")
            config(userOneId, mine, "kalos-the-guardian")
            // The same name, on somebody else's account. Nothing about the path says whose it is,
            // so the ownership filter is the only thing standing between them.
            val theirs = addCharacter(userTwoId, "MechoBotto")
            val theirParty = config(userTwoId, theirs, "kalos-the-guardian")

            assertEquals(
                theirParty.id,
                findPartyBySlug(listOf("mechobotto", "kalos-the-guardian"), userTwoId)?.id,
            )
            assertNull(findPartyBySlug(listOf("mechobotto", "baldrix"), userTwoId))
        }
    }

    @Test
    fun `a slug that names nothing resolves to nothing`() {
        transaction {
            val mine = addCharacter(userOneId, "MechoBotto")
            config(userOneId, mine, "kalos-the-guardian")

            // A boss this character has no config for, a character that does not exist, a path
            // longer than a slug can be, and a single segment that is not a uuid.
            assertNull(findPartyBySlug(listOf("mechobotto", "baldrix"), userOneId))
            assertNull(findPartyBySlug(listOf("nobody", "kalos-the-guardian"), userOneId))
            assertNull(findPartyBySlug(listOf("a", "b", "c", "kalos-the-guardian"), userOneId))
            assertNull(findPartyBySlug(listOf("mechobotto"), userOneId))
            assertNull(findPartyBySlug(emptyList(), userOneId))
        }
    }
}
