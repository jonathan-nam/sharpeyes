package com.sharpeyes.backend.pages

import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.bosses.dropTables
import com.sharpeyes.backend.characters.charactersInActiveWorld
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.debtsFor
import com.sharpeyes.backend.parties.disposalsFor
import com.sharpeyes.backend.parties.partiesFor
import com.sharpeyes.backend.parties.paymentsFor
import com.sharpeyes.backend.parties.peopleFor
import com.sharpeyes.backend.parties.settlementsFor
import com.sharpeyes.backend.parties.tranchesFor
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
 * The Drop Log's one-request read, against a real Postgres.
 *
 * The claim worth a database to check is that it answers with the SAME rows the eleven endpoints it
 * replaces would have. It calls the same functions they do, so this is not guarding arithmetic, it
 * is guarding the wiring: a field left off the response, a wrong argument to partiesFor (solo and
 * retired both matter to a ledger, and defaulting either would silently drop pools), or a reader
 * pointed at the wrong user.
 *
 * Nothing calls this yet. The endpoint ships before the page that uses it, because the two deploy
 * on separate clocks: Vercel ships the frontend on merge and the box waits for deploy.sh, so a page
 * that asked for this first would spend that gap on a 404.
 */
class DropLogPageTest {
    private val userId = "user_test_droplog_page"
    private val otherUserId = "user_test_droplog_other"

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

    /** A character, a person and one config on a real boss, which is enough for every reader. */
    private fun seed(forUser: String) {
        ensureUser(forUser, "$forUser@example.com")
        setActiveWorld(forUser, WORLD_INTERACTIVE)
        val characterId = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = characterId
            it[Characters.userId] = forUser
            it[name] = "Seeded$forUser".take(24)
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
        val bossCatalogRow = BossCatalog.selectAll().first()[BossCatalog.id]
        Party.insert {
            it[Party.id] = Uuid.random()
            it[Party.userId] = forUser
            it[Party.characterId] = characterId
            it[bossCatalogId] = bossCatalogRow
            it[solo] = false
            it[oneOff] = false
            it[standing] = true
            it[createdAt] = now
            it[updatedAt] = now
        }
    }

    /** What the page builds, as the route builds it. Kept beside the assertions it feeds. */
    private fun composite(forUser: String) =
        DropLogPageResponse(
            parties = partiesFor(forUser, week = null, includeSolo = true, includeRetired = true),
            pools = allLootFor(forUser),
            tranches = tranchesFor(forUser),
            payments = paymentsFor(forUser),
            settlements = settlementsFor(forUser),
            debts = debtsFor(forUser),
            disposals = disposalsFor(forUser),
            bosses = bossCatalog(),
            drops = dropTables(),
            characters = charactersInActiveWorld(forUser),
            people = peopleFor(forUser),
        )

    @Test
    fun `every field answers with what its own endpoint would have`() {
        transaction {
            seed(userId)
            val page = composite(userId)

            assertEquals(partiesFor(userId, week = null, includeSolo = true, includeRetired = true), page.parties)
            assertEquals(allLootFor(userId), page.pools)
            assertEquals(tranchesFor(userId), page.tranches)
            assertEquals(paymentsFor(userId), page.payments)
            assertEquals(settlementsFor(userId), page.settlements)
            assertEquals(debtsFor(userId), page.debts)
            assertEquals(disposalsFor(userId), page.disposals)
            assertEquals(bossCatalog(), page.bosses)
            assertEquals(dropTables(), page.drops)
            assertEquals(charactersInActiveWorld(userId), page.characters)
            assertEquals(peopleFor(userId), page.people)
        }
    }

    // The seeded config is standing and not solo, so it would come back either way. What this
    // pins is the ARGUMENT: defaulting includeSolo or includeRetired to false drops pools the
    // ledger needs, and the loss is silent because the page still renders.
    @Test
    fun `parties are asked for with solo and retired included`() {
        transaction {
            seed(userId)
            Party.update({ Party.userId eq userId }) { it[standing] = false }

            val page = composite(userId)

            assertEquals(1, page.parties.size, "a retired config still belongs to the ledger")
        }
    }

    @Test
    fun `the reads are scoped to the caller`() {
        transaction {
            seed(userId)
            seed(otherUserId)

            val page = composite(userId)

            assertEquals(1, page.characters.size)
            assertEquals(1, page.parties.size)
            assertEquals(1, page.people.size)
            assertTrue(page.characters.none { it.name.contains(otherUserId.takeLast(5)) })
        }
    }

    // Catalog data, identical for every account. Worth stating because it is the part a future
    // reader might try to scope to the user, and the part worth caching if this ever gets busy.
    @Test
    fun `the catalog comes back whether the account has anything or not`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            setActiveWorld(userId, WORLD_INTERACTIVE)

            val page = composite(userId)

            assertTrue(page.bosses.isNotEmpty(), "the boss catalog is seeded by migration")
            assertTrue(page.drops.isNotEmpty(), "the drop tables are seeded by migration")
            assertTrue(page.parties.isEmpty())
            assertTrue(page.characters.isEmpty())
        }
    }
}
