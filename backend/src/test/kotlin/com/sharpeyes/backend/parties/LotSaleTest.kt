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
 * Selling a pile of one interchangeable drop in one go, against a real Postgres.
 *
 * What is worth a database here is that a refusal writes NOTHING. A lot spans pools, so a loop that
 * priced three rows and then hit a fourth it could not sell would commit the three, and no screen
 * would say which of them had landed. That shape is worse than a refusal, because the figures it
 * leaves all look ordinary.
 *
 * The catalog side is pinned too. Which drops may be sold this way is a decision about what those
 * drops ARE, and the flag is the only thing standing between the queue and a drop whose copies each
 * have their own price.
 */
class LotSaleTest {
    private val userId = "user_test_lot_sale_1"
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
        // Held in a local: inside deleteWhere {} a bare `userId` binds to the COLUMN. See
        // PartyLootTest for the full account.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** Your character plus one other. Yours is stored as the first seat. */
    private fun duo(boss: String): PartyResponse {
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
        val request = SavePartyRequest(mine.toString(), boss, listOf("Steve"))
        val id = createParty(userId, mine, bossIdForKey(boss)!!, request, now)
        return findParty(id, userId)!!
    }

    private fun addDrop(
        party: PartyResponse,
        dropKey: String,
    ): Uuid =
        addLoot(
            Uuid.parse(party.id),
            LootedDrop(dropIdForKey(dropKey)!!),
            bossIdForKey(party.bossKey),
            dropped,
            Clock.System.now(),
        )

    private fun row(
        party: PartyResponse,
        lootId: Uuid,
        amount: Long,
        seller: String = party.members.first().id,
    ) = LotRow(
        Uuid.parse(party.id),
        lootId,
        amount,
        Uuid.parse(seller),
        party.members.associate { it.id to 1 },
    )

    private fun sellLot(
        dropKey: String,
        rows: List<LotRow>,
    ) = sellLot(userId, dropKey, "RECEIVED", "FAIR", rows, Clock.System.now())

    @Test
    fun `a lot prices every row it names, across pools`() {
        transaction {
            val limbo = duo("limbo")
            val baldrix = duo("baldrix")
            val first = addDrop(limbo, "grindstone-of-faith")
            val second = addDrop(baldrix, "grindstone-of-faith")

            assertNull(
                sellLot(
                    "grindstone-of-faith",
                    listOf(row(limbo, first, 500_000_000), row(baldrix, second, 500_000_000)),
                ),
            )

            val one = findLoot(first, Uuid.parse(limbo.id))!!
            val two = findLoot(second, Uuid.parse(baldrix.id))!!
            assertEquals(500_000_000, one.saleAmount)
            assertEquals(500_000_000, two.saleAmount)
            // The ordinary sale, so the row carries what any sold row carries and the split reads it
            // the way it reads every other one.
            assertEquals("RECEIVED", one.amountBasis)
            assertEquals("FAIR", one.splitMethod)
            assertEquals(limbo.members.first().id, one.sellerMemberId)
            // One payout row for the seat that is not the seller, which is what makes it SOLD rather
            // than settled.
            assertEquals("SOLD", one.status)
            assertEquals(1, one.payouts.size)
        }
    }

    @Test
    fun `a drop that is not sold as a lot is refused, and nothing is written`() {
        transaction {
            val party = duo("limbo")
            val unique = addDrop(party, "whisper-of-the-source")

            val why = sellLot("whisper-of-the-source", listOf(row(party, unique, 12_000_000_000)))
            assertTrue(why!!.contains("not sold as a lot"))
            // The whole point of the flag: a ring with its own potential lines cannot be assigned by
            // a queue, so the row is still waiting to be priced where it sits.
            assertEquals("PENDING", findLoot(unique, Uuid.parse(party.id))!!.status)
            assertNull(findLoot(unique, Uuid.parse(party.id))!!.saleAmount)
        }
    }

    @Test
    fun `one row it cannot sell refuses the whole lot`() {
        transaction {
            val party = duo("limbo")
            val partyId = Uuid.parse(party.id)
            val good = addDrop(party, "grindstone-of-faith")
            val alreadySold = addDrop(party, "grindstone-of-faith")

            // Sold by hand, the way somebody who priced one row before opening the Drop Log would
            // have left it. The queue that proposed this lot is stale.
            sellLoot(
                alreadySold,
                SellLootRequest(1_000_000_000, "LISTED", "FAIR", party.members.first().id),
                Uuid.parse(party.members.first().id),
                partyId,
                Clock.System.now(),
            )

            val why =
                sellLot(
                    "grindstone-of-faith",
                    listOf(row(party, good, 500_000_000), row(party, alreadySold, 500_000_000)),
                )
            assertTrue(why!!.contains("has sold since this list was drawn"))
            // The row it COULD have sold is untouched. A half-priced lot is the shape nobody can
            // correct, since nothing says which half landed.
            assertEquals("PENDING", findLoot(good, partyId)!!.status)
            // And the one that was already sold keeps the price somebody entered by hand.
            assertEquals(1_000_000_000, findLoot(alreadySold, partyId)!!.saleAmount)
        }
    }

    @Test
    fun `a kept row refuses the whole lot`() {
        transaction {
            val party = duo("limbo")
            val partyId = Uuid.parse(party.id)
            val good = addDrop(party, "grindstone-of-faith")
            val kept = addDrop(party, "grindstone-of-faith")
            setLootTakenBy(kept, Uuid.parse(party.members.first().id), Clock.System.now())

            val why =
                sellLot(
                    "grindstone-of-faith",
                    listOf(row(party, good, 500_000_000), row(party, kept, 500_000_000)),
                )
            assertTrue(why!!.contains("was kept since this list was drawn"))
            assertEquals("PENDING", findLoot(good, partyId)!!.status)
            assertEquals("TAKEN", findLoot(kept, partyId)!!.status)
        }
    }

    @Test
    fun `a seller who did not run that week is refused`() {
        transaction {
            val party = duo("limbo")
            val stone = addDrop(party, "grindstone-of-faith")
            val stranger = Uuid.random()

            val why =
                sellLot(
                    "grindstone-of-faith",
                    listOf(row(party, stone, 500_000_000, seller = stranger.toString())),
                )
            assertTrue(why!!.contains("somebody who ran this boss that week"))
            assertEquals("PENDING", findLoot(stone, Uuid.parse(party.id))!!.status)
        }
    }

    @Test
    fun `a lot may not reach a pool this account does not own`() {
        transaction {
            val party = duo("limbo")
            val stone = addDrop(party, "grindstone-of-faith")

            val why =
                sellLot("grindstone-of-faith", listOf(row(party, stone, 500_000_000).copy(partyId = Uuid.random())))
            assertTrue(why!!.contains("not in your parties"))
            assertEquals("PENDING", findLoot(stone, Uuid.parse(party.id))!!.status)
        }
    }

    @Test
    fun `every row of a lot has to be the same drop`() {
        transaction {
            val party = duo("limbo")
            val stone = addDrop(party, "grindstone-of-faith")
            val box = addDrop(party, "eternal-armor-of-desire-box")

            val why =
                sellLot(
                    "grindstone-of-faith",
                    listOf(row(party, stone, 500_000_000), row(party, box, 500_000_000)),
                )
            assertTrue(why!!.contains("the same drop"))
            assertEquals("PENDING", findLoot(stone, Uuid.parse(party.id))!!.status)
        }
    }

    /**
     * The classification itself, so it cannot drift in catalog/drops.yaml without a test saying so.
     *
     * Both halves matter. A drop wrongly marked fungible gets assigned by a queue that cannot know
     * which copy went, and one wrongly left out is a pile you still have to price row by row.
     */
    @Test
    fun `only interchangeable drops are sold as a lot`() {
        transaction {
            val asLots =
                listOf(
                    "grindstone-of-faith",
                    "grindstone-of-life",
                    "eternal-armor-of-desire-box",
                    "divine-eternal-armor-box",
                    "ferocious-beast-eternal-armor-box",
                    "ancient-eternal-armor-box",
                    "eternal-armor-of-oaths-box",
                    "eternal-armor-of-radiance-box",
                )
            asLots.forEach { assertNull(lotDropRefusal(it), "$it should be sold as a lot") }

            // Accessories and rings have their own potential lines, so two copies are two prices.
            // Vestige coupons settle through the tranche ledger instead.
            listOf(
                "whisper-of-the-source",
                "oath-of-death",
                "immortal-legacy",
                "blissful-nightmare",
                "exceptional-hammer-face",
                "mitras-rage-selection-box",
                "ring-of-restraint-4",
                "continuous-ring-4",
                "vestige-of-erion",
            ).forEach {
                assertTrue(
                    lotDropRefusal(it)!!.contains("not sold as a lot"),
                    "$it should not be sold as a lot",
                )
            }

            // A key the catalog does not have at all is refused too, rather than throwing.
            assertTrue(lotDropRefusal("no-such-drop") != null)
        }
    }
}
