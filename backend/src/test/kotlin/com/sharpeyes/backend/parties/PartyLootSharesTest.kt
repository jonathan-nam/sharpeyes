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
 * How much of a pot each seat takes, and how many of a drop fell, against a real Postgres.
 *
 * Both exist for the nights that do not divide. Vestige of Erion Coupons come in bundles and a party
 * normally loots an equal number each, recording nothing at all; a pool row is the remainder one
 * member took because it would not divide, or a carry the party agreed takes more than a share.
 * What is worth a database to check is that a share count is PINNED to the sale like the payout
 * roster beside it: a weight edited next month must not rewrite a night already settled, and
 * correcting a price must not lose who has been paid.
 *
 * Split from PartyLootTest, which was already at the size detekt allows a class.
 */
class PartyLootSharesTest {
    private val userId = "user_test_loot_shares_1"
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
        // Held in a local for the reason PartyLootTest gives at length: inside deleteWhere {} a bare
        // `userId` binds to the COLUMN, and the predicate would be true of every row.
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

    private fun sale(sellerId: String) = SellLootRequest(9_500_000_000, "LISTED", "FAIR", sellerId)

    @Test
    fun `a drop that stacks is one row with a count on it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            // Six bundles of 30 off Extreme Kalos, which will not divide by a party of four, so
            // one member took all 180 to sell.
            addLoot(
                partyId,
                LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 180),
                bossIdForKey("limbo"),
                dropped,
                Clock.System.now(),
            )

            val loot = lootFor(partyId).single()
            assertEquals("Vestige of Erion Coupon", loot.name)
            assertEquals(180, loot.quantity)
            // A drop that is one item says so without anybody typing it.
            assertEquals(1, findLoot(addGrindstone(party), partyId)!!.quantity)
        }
    }

    @Test
    fun `a count outside what the column holds is refused rather than clamped`() {
        assertNull(quantityRefusal(1))
        assertNull(quantityRefusal(180))
        assertNull(quantityRefusal(1_000_000))
        assertTrue(quantityRefusal(0)!!.contains("between 1"))
        assertTrue(quantityRefusal(-1)!!.contains("between 1"))
        // The DB CHECK's own bound. If this passes here it fails in Postgres, which is a 500.
        assertTrue(quantityRefusal(1_000_001)!!.contains("1000000"))
    }

    @Test
    fun `a sale pins the share each seat took, and an even one says one`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            val steve = party.members.first { it.name == "Steve" }

            // Steve carries, so the party agreed he takes double.
            sellLoot(
                lootId,
                sale(seller.id).copy(shares = mapOf(steve.id to 2)),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )

            val sold = findLoot(lootId, partyId)!!
            assertEquals(1, sold.sellerShares)
            assertEquals(2, sold.payouts.single { it.memberId == steve.id }.shares)
            assertEquals(1, sold.payouts.single { it.memberId != steve.id }.shares)
        }
    }

    @Test
    fun `correcting a sale corrects its shares and still leaves who has been paid alone`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            val steve = party.members.first { it.name == "Steve" }
            sellLoot(
                lootId,
                sale(seller.id).copy(shares = mapOf(steve.id to 3)),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )
            setPayoutPaid(lootId, Uuid.parse(steve.id), true, Clock.System.now())

            // A 3 that should have been a 2, fixed after somebody was already paid.
            sellLoot(
                lootId,
                sale(seller.id).copy(shares = mapOf(steve.id to 2, seller.id to 2)),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )

            val loot = findLoot(lootId, partyId)!!
            assertEquals(2, loot.sellerShares)
            assertEquals(2, loot.payouts.single { it.memberId == steve.id }.shares)
            assertTrue(loot.payouts.single { it.memberId == steve.id }.paid)
            // A seat dropped from the request goes back to one rather than keeping the old count.
            assertEquals(1, loot.payouts.single { it.memberId != steve.id }.shares)
        }
    }

    @Test
    fun `unselling drops the share counts with the rest of the sale`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(
                lootId,
                sale(seller.id).copy(shares = mapOf(seller.id to 2)),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )
            unsellLoot(lootId, Clock.System.now())

            assertNull(findLoot(lootId, partyId)!!.sellerShares)
        }
    }

    @Test
    fun `a share for somebody who did not run is refused, not ignored`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val ran = findLoot(lootId, partyId)!!.ranThatWeek

            assertNull(sharesRefusal(mapOf(ran.first() to 2), ran))
            assertTrue(
                sharesRefusal(mapOf(Uuid.random().toString() to 2), ran)!!.contains("ran this boss"),
            )
            // Zero is a seat that takes nothing from this party, which V44 exists for.
            assertNull(sharesRefusal(mapOf(ran.first() to 0), ran))
            assertTrue(sharesRefusal(mapOf(ran.first() to -1), ran)!!.contains("between 0"))
            assertTrue(sharesRefusal(mapOf(ran.first() to 100), ran)!!.contains("99"))
            // Everybody on zero is not: it divides the pot by nothing.
            assertTrue(
                sharesRefusal(ran.associateWith { 0 }, ran)!!.contains("has to take a share"),
            )
        }
    }

    @Test
    fun `a seat carries a standing share, and editing it cannot rewrite a settled sale`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            val steve = party.members.first { it.name == "Steve" }

            // Sold on the night at double, then the standing weight is changed afterwards.
            sellLoot(
                lootId,
                sale(seller.id).copy(shares = mapOf(steve.id to 2)),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), shares = mapOf("Steve" to 5)),
                Clock.System.now(),
            )

            assertEquals(5, findParty(partyId, userId)!!.members.first { it.name == "Steve" }.shares)
            assertEquals(1, findParty(partyId, userId)!!.members.first { it.name == "Bob" }.shares)
            assertEquals(2, findLoot(lootId, partyId)!!.payouts.single { it.memberId == steve.id }.shares)
        }
    }
}
