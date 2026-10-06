package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.db.VestigeSettlement
import com.sharpeyes.backend.db.VestigeSettlementLoot
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

/**
 * The drops a clear implies on a boss run alone, against a real Postgres.
 *
 * Vestige coupons are guaranteed and the catalog knows the amount, so clearing the boss alone already
 * says they landed. What is worth a database to check is everything this must NOT do: file for a
 * PARTY, file twice for one period, file at a difficulty that drops none, file where nobody has said
 * which difficulty, or take back a row somebody has already sold.
 */
class LootFromClearTest {
    private val userId = "user_test_from_clear_1"
    private val today = LocalDate.parse("2026-08-08")

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
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            // After the pools, whose drops the closures point at. Nothing cascades the other way.
            VestigeSettlement.deleteWhere { VestigeSettlement.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** One character of this account, which every case here runs something on. */
    private fun character(): Uuid {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Husky"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return mine
    }

    /** A pool this character runs ALONE, on Extreme Kalos unless [difficulty] or [boss] says otherwise. */
    private fun alone(
        difficulty: String? = "EXTREME",
        boss: String = "kalos-the-guardian",
    ): Pair<Uuid, Uuid> {
        val mine = character()
        val bossId = bossIdForKey(boss)!!
        val now = Clock.System.now()
        val partyId =
            if (difficulty == null) {
                poolFor(userId, mine, bossId, now)
            } else {
                setSoloDifficulty(userId, mine, bossId, bossResetOf(bossId)!!, difficulty, now)!!
            }
        return mine to partyId
    }

    /** A party on Extreme Kalos, which drops 180 coupons, unless [difficulty] says otherwise. */
    private fun party(
        difficulty: String? = "EXTREME",
        boss: String = "kalos-the-guardian",
        others: List<String> = listOf("Steve"),
        looterName: String? = null,
    ): Pair<Uuid, Uuid> {
        val mine = character()
        val now = Clock.System.now()
        val bossId = bossIdForKey(boss)!!
        val request =
            SavePartyRequest(
                mine.toString(),
                boss,
                others,
                difficulty = difficulty,
                looterName = looterName,
            )
        return mine to createParty(userId, mine, bossId, request, now)
    }

    private fun pool(partyId: Uuid) = lootFor(partyId)

    /** The coupon row, which is what these tests are about. */
    private fun coupon(partyId: Uuid) = pool(partyId).single { it.dropKey == "vestige-of-erion" }

    @Test
    fun `clearing a boss run alone files what it guarantees, off the catalog's own count`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!

            lootFromClear(characterId, bossId, "WEEKLY", today, Clock.System.now())

            val row = coupon(partyId)
            assertEquals("Vestige of Erion Coupon", row.name)
            // 180, not a share of 180. There is one seat, so those are the same number here, and the
            // row is WHAT FELL either way. See V40.
            assertEquals(180, row.quantity)
            assertEquals("kalos-the-guardian", row.bossKey)
            assertTrue(findParty(partyId, userId)!!.solo)
        }
    }

    @Test
    fun `a party's coupons are nobody's to file, however plainly the catalog states them`() {
        transaction {
            // Hard Limbo's 60 are as guaranteed here as anywhere. What a party does with them is not:
            // three stacks between two people is a night somebody has to remember agreeing to, and a
            // row that appeared on its own is one nobody entered. It is typed, with the count filled
            // in from this config's own mode.
            val (characterId, partyId) = party(difficulty = "HARD", boss = "limbo", others = listOf("Steve", "Bob"))

            lootFromClear(characterId, bossIdForKey("limbo")!!, "WEEKLY", today, Clock.System.now())

            assertTrue(pool(partyId).isEmpty())
        }
    }

    @Test
    fun `a designated looter does not make the coupons the app's to file either`() {
        transaction {
            // The Husky arrangement: the partner loots and sells everything. Naming a looter says who
            // will be holding the pieces, not that anybody has been.
            val (characterId, partyId) =
                party(
                    difficulty = "HARD",
                    boss = "limbo",
                    others = listOf("Steve", "Bob"),
                    looterName = "Steve",
                )
            lootFromClear(characterId, bossIdForKey("limbo")!!, "WEEKLY", today, Clock.System.now())
            assertTrue(pool(partyId).isEmpty())
        }
    }

    @Test
    fun `a pool adopted into a party stops collecting from the tick`() {
        transaction {
            // The seat that was alone is spelled out onto the weeks that already hold a drop, and from
            // here on the pool is a party: what falls is somebody's to enter. Without this, a party
            // built out of a solo pool kept filing itself while the roster argued over the split.
            val (characterId, partyId) = alone(difficulty = "HARD", boss = "limbo")
            val bossId = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            adoptSoloParty(
                userId,
                partyId,
                SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"), difficulty = "HARD"),
                now,
            )

            lootFromClear(characterId, bossId, "WEEKLY", today, now)

            assertTrue(pool(partyId).isEmpty())
            assertTrue(!findParty(partyId, userId)!!.solo)
        }
    }

    @Test
    fun `re-ticking the same clear does not stack up a second row`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            // Two days later in the same week, which is the same period and so the same 180.
            lootFromClear(characterId, bossId, "WEEKLY", LocalDate.parse("2026-08-10"), now)

            assertEquals(1, pool(partyId).size)
            assertEquals(1, pool(partyId).count { it.dropKey == "vestige-of-erion" })
        }
    }

    @Test
    fun `says nothing where the amount is unknown`() {
        transaction {
            // Easy Kalos drops none of anything, and the catalog carries no row for it rather than
            // a zero: nothing to fill is what an empty box already says.
            val (easyCharacter, easyParty) = alone(difficulty = "EASY")
            lootFromClear(
                easyCharacter,
                bossIdForKey("kalos-the-guardian")!!,
                "WEEKLY",
                today,
                Clock.System.now(),
            )
            assertTrue(pool(easyParty).isEmpty())
        }
        cleanUp()
        transaction {
            // And a pool where nobody has said which difficulty cannot know which amount applies.
            // The reason the mode is asked for at all: Extreme Kalos gives 180 and Chaos none, and a
            // clear does not say which was killed. Guessing is the wrong count wearing a real name.
            val (quietCharacter, quietParty) = alone(difficulty = null)
            lootFromClear(
                quietCharacter,
                bossIdForKey("kalos-the-guardian")!!,
                "WEEKLY",
                today,
                Clock.System.now(),
            )
            assertTrue(pool(quietParty).isEmpty())
        }
    }

    @Test
    fun `un-ticking takes back what the clear added, and leaves a sale alone`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            unlootFromClear(characterId, bossId, "WEEKLY", today)
            assertTrue(pool(partyId).isEmpty(), "a row the clear added and nobody touched goes with it")

            // Sold, and now the clear is un-ticked: that is money somebody is owed, and un-ticking a
            // clear says nothing about it.
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            val row = coupon(partyId)
            val seller = findParty(partyId, userId)!!.members.first()
            sellLoot(
                Uuid.parse(row.id),
                SellLootRequest(4_420_000_000, "RECEIVED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                now,
            )
            unlootFromClear(characterId, bossId, "WEEKLY", today)
            assertEquals(1, pool(partyId).size)
        }
    }

    @Test
    fun `un-ticking leaves a pile whose books have been closed`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            // Coupons never get a sold_at: they settle through the tranche ledger, so "unsold" says
            // nothing about whether anybody is finished with them. Closing the books is what does,
            // and the closure names this row, so deleting it would take the closure with it.
            closeBooks(Uuid.parse(coupon(partyId).id), now)

            unlootFromClear(characterId, bossId, "WEEKLY", today)

            assertEquals(1, pool(partyId).size)
        }
    }

    /** One act of closing a holder's books over one drop, as VestigeSettlementRoutes writes it. */
    private fun closeBooks(
        lootId: Uuid,
        now: Instant,
    ) {
        val settlementId = Uuid.random()
        val owner = userId
        VestigeSettlement.insert {
            it[id] = settlementId
            it[VestigeSettlement.userId] = owner
            it[holderKind] = "SELF"
            it[unpaid] = 0
            it[settledAt] = now
            it[createdAt] = now
        }
        VestigeSettlementLoot.insert {
            it[VestigeSettlementLoot.settlementId] = settlementId
            it[VestigeSettlementLoot.lootId] = lootId
        }
    }

    @Test
    fun `a retired pool collects nothing more, and a clear does not bring it back`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            // A drop somebody LOGGED, so deleting the config retires it and keeps the pool. A
            // clear-filed row would not do here any more: deleting takes this period's tick back
            // and its coupons with it, and a config nothing else points at is deleted outright.
            // See withdrawClear.
            val logged =
                addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, today, now)
            assertEquals(Removal.RETIRED, retireOrDeleteParty(partyId, userId, now))

            // A later week, so it is the retirement stopping this and not the once-a-period rule.
            lootFromClear(characterId, bossId, "WEEKLY", LocalDate.parse("2026-08-15"), now)

            // addLoot revives whatever it inserts into, which is right for a drop somebody logged
            // and wrong for a clear: ticking the boss would un-delete the pool as a side effect.
            assertEquals(
                listOf(logged.toString()),
                pool(partyId).map { it.id },
                "a pool you deleted does not keep collecting",
            )
            assertTrue(findParty(partyId, userId)!!.retired)
        }
    }

    @Test
    fun `a row filed into an earlier period is still the clear's to take back`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            // A period that is over, which is the one deleting the config does not reach into.
            val backThen = LocalDate.parse("2026-07-25")

            lootFromClear(characterId, bossId, "WEEKLY", backThen, now)
            retireOrDeleteParty(partyId, userId, now)

            // Rows filed into a pool before it was retired stay removable by the tick that put
            // them there, which is the only thing that may take them.
            assertEquals(1, pool(partyId).size)
            unlootFromClear(characterId, bossId, "WEEKLY", backThen)
            assertTrue(pool(partyId).isEmpty())
        }
    }

    @Test
    fun `a row a human logged is never taken back by a clear`() {
        transaction {
            val (characterId, partyId) = alone()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            // Typed, not filed from a clear: they saw it fall, so the clear does not answer for it.
            addLoot(partyId, LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 60), bossId, today, now)

            unlootFromClear(characterId, bossId, "WEEKLY", today)

            assertEquals(60, pool(partyId).single().quantity)
        }
    }
}
