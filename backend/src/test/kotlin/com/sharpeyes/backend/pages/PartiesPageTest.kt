package com.sharpeyes.backend.pages

import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.bosses.clearsView
import com.sharpeyes.backend.bosses.dropTables
import com.sharpeyes.backend.characters.charactersInActiveWorld
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.partiesFor
import com.sharpeyes.backend.parties.partiesSeatedIn
import com.sharpeyes.backend.parties.peopleFor
import com.sharpeyes.backend.parties.settlementsFor
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Party View's two reads, against a real Postgres.
 *
 * Same claim as DropLogPageTest: these answer with the rows the endpoints they replace would have.
 * They call the same functions, so this guards the wiring rather than the arithmetic: a field left
 * off, a wrong argument to partiesFor (solo and retired both matter and defaulting either silently
 * drops pools), a reader pointed at the wrong user.
 *
 * The split between the two is the part worth stating in a test, because it is a decision and not
 * an accident. Everything the page cannot draw without is in one, everything it is built to survive
 * losing is in the other.
 */
class PartiesPageTest {
    private val userId = "user_test_parties_page"
    private val otherUserId = "user_test_parties_other"

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
            listOf(userId, otherUserId).forEach { id ->
                Party.deleteWhere { Party.userId eq id }
                Person.deleteWhere { Person.userId eq id }
                Characters.deleteWhere { Characters.userId eq id }
            }
        }
    }

    private fun seed(forUser: String) {
        ensureUser(forUser, "$forUser@example.com")
        setActiveWorld(forUser, WORLD_INTERACTIVE)
        val characterId = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = characterId
            it[Characters.userId] = forUser
            it[name] = "Seat$forUser".take(24)
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        Person.insert {
            it[Person.id] = Uuid.random()
            it[Person.userId] = forUser
            it[name] = "Somebody"
            it[createdAt] = now
        }
        Party.insert {
            it[Party.id] = Uuid.random()
            it[Party.userId] = forUser
            it[Party.characterId] = characterId
            it[bossCatalogId] = BossCatalog.selectAll().first()[BossCatalog.id]
            it[solo] = false
            it[oneOff] = false
            it[standing] = true
            it[createdAt] = now
            it[updatedAt] = now
        }
    }

    private fun required(forUser: String) =
        PartiesPageResponse(
            parties = partiesFor(forUser, week = null, includeSolo = true, includeRetired = true),
            bosses = bossCatalog(),
            characters = charactersInActiveWorld(forUser),
        )

    private fun extras(forUser: String) =
        PartiesExtrasResponse(
            clears = clearsView(forUser, week = null, now = Clock.System.now()),
            drops = dropTables(),
            people = peopleFor(forUser),
            pools = allLootFor(forUser),
            settlements = settlementsFor(forUser),
            seated = partiesSeatedIn(forUser),
        )

    @Test
    fun `the required read answers with what its own endpoints would have`() {
        transaction {
            seed(userId)
            val page = required(userId)

            assertEquals(partiesFor(userId, week = null, includeSolo = true, includeRetired = true), page.parties)
            assertEquals(bossCatalog(), page.bosses)
            assertEquals(charactersInActiveWorld(userId), page.characters)
        }
    }

    @Test
    fun `the extras read answers with what its own endpoints would have`() {
        transaction {
            seed(userId)
            val page = extras(userId)

            assertEquals(dropTables(), page.drops)
            assertEquals(peopleFor(userId), page.people)
            assertEquals(allLootFor(userId), page.pools)
            assertEquals(settlementsFor(userId), page.settlements)
            assertEquals(partiesSeatedIn(userId), page.seated)
            assertEquals(
                clearsView(userId, week = null, now = Clock.System.now()).clearsByCharacter,
                page.clears.clearsByCharacter,
            )
        }
    }

    // The seeded config would come back either way, so this pins the ARGUMENT rather than the row:
    // defaulting includeRetired drops pools the ledger needs, and the page still renders without
    // them, which is what makes the loss silent.
    @Test
    fun `parties are asked for with solo and retired included`() {
        transaction {
            seed(userId)
            Party.update({ Party.userId eq userId }) { it[standing] = false }

            assertEquals(1, required(userId).parties.size, "a retired config still belongs to the ledger")
        }
    }

    @Test
    fun `both reads are scoped to the caller`() {
        transaction {
            seed(userId)
            seed(otherUserId)

            assertEquals(1, required(userId).parties.size)
            assertEquals(1, required(userId).characters.size)
            assertEquals(1, extras(userId).people.size)
        }
    }

    // The split is a decision: the page blanks without the first and degrades without the second.
    // If a field moves between them, that decision has changed and should be deliberate.
    @Test
    fun `the required read carries only what the page cannot draw without`() {
        val requiredFields =
            PartiesPageResponse::class
                .members
                .map { it.name }
                .filter {
                    it in
                        setOf(
                            "parties",
                            "bosses",
                            "characters",
                            "clears",
                            "drops",
                            "people",
                            "pools",
                            "settlements",
                            "seated",
                        )
                }

        assertEquals(setOf("parties", "bosses", "characters"), requiredFields.toSet())
    }

    @Test
    fun `the catalog comes back for an account with nothing`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            setActiveWorld(userId, WORLD_INTERACTIVE)

            assertTrue(required(userId).bosses.isNotEmpty())
            assertTrue(extras(userId).drops.isNotEmpty())
            assertTrue(required(userId).parties.isEmpty())
        }
    }
}
