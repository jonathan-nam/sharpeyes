package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Duration.Companion.hours
import kotlin.uuid.Uuid

/**
 * A holder's sale tally, against a real Postgres.
 *
 * Four claims are worth a database. That the tally comes back OLDEST FIRST, because that is the
 * order the queue spends it in and reversing it would re-price every boss. That it is scoped to the
 * account, since it is read without naming a party and an account-wide read is where a missing
 * `where` shows up as somebody else's sales. That the holder columns cannot disagree with the kind,
 * which is the constraint standing between a pile and belonging to nobody. And that a redemption
 * carries no price, where a zero would have been a price and the wrong one.
 */
class VestigeTrancheTest {
    private val userId = "user_test_tranche_1"
    private val strangerId = "user_test_tranche_2"

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
        val owners = listOf(userId, strangerId)
        transaction {
            VestigeTranche.deleteWhere { VestigeTranche.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Users.deleteWhere { Users.id inList owners }
        }
    }

    /** Somebody on the people list, which is what a PERSON tranche is filed against. */
    private fun person(
        owner: String,
        name: String,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        Person.insert {
            it[Person.id] = id
            it[userId] = owner
            it[Person.name] = name
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }

    private fun tranche(
        owner: String,
        holder: Uuid?,
        pieces: Int,
        amount: Long?,
        hoursAgo: Long,
        disposition: String = "SOLD",
    ) {
        val now = Clock.System.now()
        VestigeTranche.insert {
            it[id] = Uuid.random()
            it[userId] = owner
            it[holderKind] = if (holder == null) "SELF" else "PERSON"
            it[personId] = holder
            it[VestigeTranche.pieces] = pieces
            it[VestigeTranche.amount] = amount
            it[VestigeTranche.disposition] = disposition
            it[soldAt] = now - hoursAgo.hours
            it[createdAt] = now
        }
    }

    @Test
    fun `the tally comes back oldest first, which is the order the queue spends it`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            tranche(userId, null, 10, 250_000_000, hoursAgo = 1)
            tranche(userId, null, 50, 1_200_000_000, hoursAgo = 5)

            val rows = tranchesFor(userId)
            assertEquals(listOf(50, 10), rows.map { it.pieces })
            // The total is what was entered; nothing here divides it into a price each.
            assertEquals(listOf(1_200_000_000L, 250_000_000L), rows.map { it.amount })
        }
    }

    @Test
    fun `one account never sees another's sales`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            ensureUser(strangerId, "$strangerId@example.com")
            tranche(userId, null, 50, 1_200_000_000, hoursAgo = 2)
            tranche(strangerId, null, 999, 9_000_000_000, hoursAgo = 2)

            assertEquals(1, tranchesFor(userId).size)
            assertEquals(50, tranchesFor(userId).single().pieces)
        }
    }

    @Test
    fun `two people keep separate piles under one account`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            // Yours, and the partner who loots the bosses run on characters that are not on your
            // account. Both tallies are yours to enter; neither can spend the other's pieces.
            val brock = person(userId, "Brock")
            tranche(userId, null, 60, 1_450_000_000, hoursAgo = 3)
            tranche(userId, brock, 20, 500_000_000, hoursAgo = 2)

            val byHolder = tranchesFor(userId).groupBy { it.holder.kind }
            assertEquals(setOf("SELF", "PERSON"), byHolder.keys)
            assertEquals(60, byHolder["SELF"]!!.single().pieces)
            assertEquals(brock.toString(), byHolder["PERSON"]!!.single().holder.personId)
        }
    }

    @Test
    fun `one person's pile survives being renamed, because it is filed by id`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val brock = person(userId, "Brock")
            tranche(userId, brock, 40, 900_000_000, hoursAgo = 1)

            Person.update({ Person.id eq brock }) { it[name] = "Brody" }

            // The pile is still one pile. A name-keyed tally would have orphaned it here, and every
            // boss it covered would have re-priced to nothing with no error.
            assertEquals(40, tranchesFor(userId).single().pieces)
        }
    }

    @Test
    fun `a tranche is refused rather than stored wrong`() {
        val self = VestigeHolder(kind = "SELF")
        val brock = VestigeHolder(kind = "PERSON", personId = Uuid.random().toString())
        val stranger = VestigeHolder(kind = "CHARACTER", characterName = "hunt")

        assertNull(trancheRefusal(self, 50, 1_200_000_000))
        assertNull(trancheRefusal(brock, 50, 1_200_000_000))
        assertNull(trancheRefusal(stranger, 50, 1_200_000_000))
        // A sale for nothing is refused, and the refusal says where that stack belongs. Allowing it
        // made the creditor absorb their share of a loss the holder chose; KEPT charges the holder.
        assertTrue(trancheRefusal(self, 30, 0)!!.contains("KEPT"))
        assertNull(trancheRefusal(self, 30, 1))

        // The kind and the reference cannot disagree, which is what keeps a pile from belonging to
        // nobody and pricing every boss it covers at zero.
        assertTrue(trancheRefusal(VestigeHolder(kind = "NOBODY"), 50, 1)!!.contains("kind"))
        assertTrue(trancheRefusal(VestigeHolder(kind = "PERSON"), 50, 1)!!.contains("personId"))
        assertTrue(trancheRefusal(VestigeHolder(kind = "CHARACTER"), 50, 1)!!.contains("characterName"))
        assertTrue(trancheRefusal(self.copy(personId = "x"), 50, 1)!!.contains("personId"))
        assertTrue(
            trancheRefusal(VestigeHolder(kind = "PERSON", personId = "not-an-id"), 50, 1)!!
                .contains("not an id"),
        )

        assertTrue(trancheRefusal(self, 0, 1)!!.contains("between 1"))
        assertTrue(trancheRefusal(self, 1_000_001, 1)!!.contains("1000000"))
        // Negative lands in the same refusal as zero: both are a sale with no money in it.
        assertTrue(trancheRefusal(self, 50, -1)!!.contains("above zero"))
    }

    @Test
    fun `a redemption carries no money, and a sale cannot be missing it`() {
        val self = VestigeHolder(kind = "SELF")

        assertNull(trancheRefusal(self, 195, null, "KEPT"))
        assertNull(trancheRefusal(self, 195, 4_875_000_000, "SOLD"))

        // The two cannot disagree, matching the check in V46. A KEPT row carrying an amount would
        // price the very pieces it exists to say were never priced, which is #281 by another route.
        assertTrue(trancheRefusal(self, 195, 4_875_000_000, "KEPT")!!.contains("amount"))
        assertTrue(trancheRefusal(self, 195, null, "SOLD")!!.contains("amount"))
        assertTrue(trancheRefusal(self, 195, null, "REDEEMED")!!.contains("disposition"))
    }

    @Test
    fun `a purchase of the creditor's pieces carries money, like a sale and unlike a redemption`() {
        val self = VestigeHolder(kind = "SELF")

        // V50. The third kind: pieces the holder was not entitled to, at a price somebody agreed
        // rather than at whatever average the holder's own sales happened to reach.
        assertNull(trancheRefusal(self, 10, 150_000_000, "BOUGHT"))
        assertTrue(trancheRefusal(self, 10, null, "BOUGHT")!!.contains("amount"))
        assertTrue(trancheRefusal(self, 10, 0, "BOUGHT")!!.contains("above zero"))
    }

    @Test
    fun `a redemption round-trips with no price, beside the sales it is not one of`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            tranche(userId, null, 195, 4_875_000_000, hoursAgo = 5)
            tranche(userId, null, 195, null, hoursAgo = 1, disposition = "KEPT")

            val rows = tranchesFor(userId)
            assertEquals(listOf("SOLD", "KEPT"), rows.map { it.disposition })
            // Null, not zero. Zero is a price, and it is the wrong one: it would make the creditor
            // absorb half of a loss nobody took. See V46.
            assertEquals(listOf(4_875_000_000L, null), rows.map { it.amount })
            assertEquals(listOf(195, 195), rows.map { it.pieces })
        }
    }

    @Test
    fun `a name arrives folded, so one pile cannot come back as two`() {
        val loud = VestigeHolder(kind = " character ", characterName = "  Hunt  ")
        assertEquals(VestigeHolder("CHARACTER", null, "hunt"), loud.normalised())
    }
}
