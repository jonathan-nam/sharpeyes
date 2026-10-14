package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * What is yours to settle or keep. A drop is settled once every share through one of your seats is
 * paid (crossesOwner), and it can be kept without a sale only where nobody else ran (onlyYours).
 *
 * Its own class rather than more of PartyLootTest, which is already the size detekt allows.
 */
class YourSharesTest {
    private val userId = "user_test_your_shares_1"
    private val dropped = LocalDate.parse("2026-09-18")

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
        // Held in a local: inside deleteWhere {} a bare `userId` binds to the COLUMN, and the
        // predicate would be true of every row. See the note in PartyLootTest.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** Your character plus two others, which is three seats: yours is stored as the first. */
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
        val request = SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"))
        val id = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
        return findParty(id, userId)!!
    }

    private fun addGrindstone(party: PartyResponse): Uuid =
        addLoot(
            Uuid.parse(party.id),
            LootedDrop(dropIdForKey("grindstone-of-faith")!!),
            bossIdForKey("limbo"),
            dropped,
            Clock.System.now(),
        )

    @Test
    fun `a drop only your characters ran can be kept, one others ran cannot`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val rune = seat(party, "Rune").id
            val solo =
                addLoot(
                    partyId,
                    LootedDrop(dropIdForKey("grindstone-of-faith")!!),
                    bossIdForKey("limbo"),
                    dropped,
                    Clock.System.now(),
                    LootSource(solo = true),
                )
            val shared = addGrindstone(party)

            val soloRan = findLoot(solo, partyId)!!.ranThatWeek
            assertTrue(onlyYours(soloRan, partyId))
            assertNull(takenRefusal(rune, soloRan, canSell = true, sold = false, onlyYours = true))

            // Steve and Bob ran too, so keeping it would quietly stop them being paid.
            val sharedRan = findLoot(shared, partyId)!!.ranThatWeek
            assertFalse(onlyYours(sharedRan, partyId))
            assertNotNull(takenRefusal(rune, sharedRan, canSell = true, sold = false, onlyYours = false))
        }
    }

    private fun seat(
        party: PartyResponse,
        name: String,
    ) = party.members.first { it.name == name }

    @Test
    fun `a drop somebody else bought is settled once your share is paid`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val steve = seat(party, "Steve")
            val rune = Uuid.parse(seat(party, "Rune").id)
            val bob = seat(party, "Bob")
            val bought = SellLootRequest(3_000_000_000, "BOUGHT", "FAIR", steve.id)
            sellLoot(lootId, bought, Uuid.parse(steve.id), partyId, Clock.System.now())
            assertEquals(STATUS_SOLD, findLoot(lootId, partyId)!!.status)

            // Steve owing Bob is theirs to settle: it is not markable here and holds nothing open.
            assertFalse(crossesOwner(lootId, Uuid.parse(bob.id)))
            assertTrue(crossesOwner(lootId, rune))

            setPayoutPaid(lootId, rune, true, Clock.System.now())
            val after = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PAID_OUT, after.status)
            assertFalse(after.payouts.first { it.memberId == bob.id }.paid)

            val counts = lootCountsFor(listOf(partyId), week = null)[partyId]!!
            assertEquals(0, counts.awaitingPayout)
            assertEquals(1, counts.settled)
        }
    }

    @Test
    fun `a drop you sold waits on every share`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val rune = seat(party, "Rune")
            val steve = seat(party, "Steve")
            val sale = SellLootRequest(9_500_000_000, "LISTED", "FAIR", rune.id)
            sellLoot(lootId, sale, Uuid.parse(rune.id), partyId, Clock.System.now())

            setPayoutPaid(lootId, Uuid.parse(steve.id), true, Clock.System.now())
            assertEquals(STATUS_SOLD, findLoot(lootId, partyId)!!.status)
            assertEquals(1, lootCountsFor(listOf(partyId), week = null)[partyId]!!.awaitingPayout)
        }
    }
}
