package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Who picked a drop up, carried with the drop that logs it, against a real Postgres.
 *
 * Until V64 the holder of an indivisible drop was written down nowhere until it SOLD, and the sale
 * is what a member who does not loot is waiting on. The claims worth a database are that the column
 * round-trips, and that the roster it is checked against is the week the drop FELL in, which is the
 * same list the seller comes from and is not a thing the request can assert about itself.
 */
class AddLootLooterTest {
    private val userId = "user_test_add_looter_1"
    private val dropped = LocalDate.parse("2026-07-20")

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
        // A local, not the property: inside deleteWhere {} a bare `userId` binds to the COLUMN. See
        // PartyLootTest.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** Your character plus two others, on a boss whose drops are one thing each. */
    private fun trio(): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request =
            SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"), difficulty = "HARD")
        val id = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
        return findParty(id, userId)!!
    }

    private fun addDrop(
        partyId: Uuid,
        looter: Uuid?,
    ): Uuid {
        val lootId =
            addLoot(
                partyId,
                LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 1),
                bossIdForKey("limbo"),
                dropped,
                Clock.System.now(),
            )
        recordLooter(lootId, looter?.toString())
        return lootId
    }

    @Test
    fun `a drop can be logged with the seat that picked it up`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val steve = party.members.first { it.name == "Steve" }

            val lootId = addDrop(partyId, Uuid.parse(steve.id))

            assertEquals(steve.id, findLoot(lootId, partyId)!!.looterMemberId)
        }
    }

    @Test
    fun `a drop logged without one says nobody has said`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)

            assertNull(findLoot(addDrop(partyId, null), partyId)!!.looterMemberId)
        }
    }

    @Test
    fun `every seat that ran that week may be named`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)

            // The same list the seller comes from, so the two selects offer the same people and a
            // looter can always go on to be named the seller.
            val ran = findLoot(addDrop(partyId, null), partyId)!!.ranThatWeek
            party.members.forEach { seat ->
                assertTrue(seat.id in ran, "${seat.name} ran that week")
                assertNull(looterRefusal(partyId, dropped, seat.id))
            }
        }
    }

    @Test
    fun `a seat that did not run that week is refused`() {
        transaction {
            val partyId = Uuid.parse(trio().id)

            val refusal = looterRefusal(partyId, dropped, Uuid.random().toString())

            assertNotNull(refusal)
            assertTrue(refusal.contains("ran that week"))
        }
    }

    @Test
    fun `an id that is not an id at all is refused`() {
        transaction {
            val partyId = Uuid.parse(trio().id)

            assertEquals("malformed looterMemberId", looterRefusal(partyId, dropped, "not-a-uuid"))
        }
    }

    @Test
    fun `naming nobody is not a refusal`() {
        transaction {
            assertNull(looterRefusal(Uuid.parse(trio().id), dropped, null))
        }
    }
}
