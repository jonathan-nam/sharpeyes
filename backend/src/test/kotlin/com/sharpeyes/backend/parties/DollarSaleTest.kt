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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A drop sold for real money, against a real Postgres.
 *
 * What is worth a database to check is the EXCLUSIVITY. A dollar sale stores cents and no meso
 * figure, a meso sale stores the reverse, and V76 refuses a row carrying both or neither. Everything
 * that has not been taught about cents reads `sale_amount` and gets null, which is a sale it
 * declines to split rather than one it prices a thousand times too low.
 *
 * Its own class rather than more of PartyLootTest, which is already the size detekt allows.
 */
class DollarSaleTest {
    private val userId = "user_test_dollar_sale_1"
    private val dropped = LocalDate.parse("2026-09-03")

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

    /** $1000, which is 100000 cents. The meso figure is sent and must be ignored. */
    private fun inDollars(sellerId: String) =
        SellLootRequest(
            amount = 0,
            amountBasis = "RECEIVED",
            splitMethod = "LAZY",
            sellerMemberId = sellerId,
            usdCents = 100_000,
        )

    @Test
    fun `a sale in dollars stores cents and leaves the meso column empty`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }

            sellLoot(lootId, inDollars(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val sold = findLoot(lootId, partyId)!!
            assertEquals(STATUS_SOLD, sold.status)
            assertEquals(100_000, sold.saleUsdCents)
            // The one that matters. A build that only knows about mesos sees no price at all here,
            // which is the refusal we want out of it and not a price off by a thousand.
            assertNull(sold.saleAmount)
            // The payout roster is the ordinary one: the unit changes nothing about who is owed.
            assertEquals(2, sold.payouts.size)
        }
    }

    @Test
    fun `correcting a dollar sale back to mesos clears the cents`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            sellLoot(lootId, inDollars(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val corrected = SellLootRequest(9_500_000_000, "LISTED", "FAIR", seller.id)
            sellLoot(lootId, corrected, Uuid.parse(seller.id), partyId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals(9_500_000_000, loot.saleAmount)
            // Left behind, this would be a row priced twice in two units, which V76 refuses outright.
            assertNull(loot.saleUsdCents)
        }
    }

    @Test
    fun `unselling takes the cents with it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            sellLoot(lootId, inDollars(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            unsellLoot(lootId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PENDING, loot.status)
            assertNull(loot.saleAmount)
            // Not merely tidiness: the sale is complete or absent (V76), so a row with cents on it
            // and no sold_at would have failed the constraint on the way out.
            assertNull(loot.saleUsdCents)
        }
    }

    private fun usd(
        basis: String,
        cents: Long,
        sellerId: String,
    ) = SellLootRequest(0, basis, "LAZY", sellerId, usdCents = cents)

    @Test
    fun `what a price in dollars may not be`() {
        val seller = Uuid.random().toString()
        // No Auction House took a cut, so there is nothing for a gross figure to be gross of.
        assertTrue(
            saleRefusal(usd("LISTED", 100_000, seller))!!
                .contains("never a listed one"),
        )
        assertNull(saleRefusal(usd("BOUGHT", 100_000, seller)))
        // Zero dollars is not a real money sale, it is an unpriced one.
        assertTrue(saleRefusal(usd("RECEIVED", 0, seller))!!.contains("nothing"))
        assertTrue(saleRefusal(usd("RECEIVED", -1, seller))!!.contains("nothing"))
        // The ceiling is on the arithmetic, not the item: the split runs in a browser, where an
        // integer stops being exact past 2^53.
        assertTrue(
            saleRefusal(usd("RECEIVED", 100_000_000_001, seller))!!
                .contains("at most"),
        )
        // A meso sale is unchanged, negatives included.
        assertNull(saleRefusal(SellLootRequest(9_500_000_000, "LISTED", "FAIR", seller)))
        assertTrue(saleRefusal(SellLootRequest(-1, "LISTED", "FAIR", seller))!!.contains("zero or more"))
    }
}
