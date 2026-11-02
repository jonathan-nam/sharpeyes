package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.bosses.clearChanged
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.minus
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
import kotlin.uuid.Uuid

/** A party's coupons filed from its clear, for an owner who asked (V102), against a real Postgres. */
class AutoVestigesTest {
    private val userId = "user_test_auto_vestiges_1"

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
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private val kalos get() = bossIdForKey("kalos-the-guardian")!!

    /** An Extreme Kalos party (180 coupons in 6 stacks) of this account's character and two others. */
    private fun party(): Uuid {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Thornwick"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val others = listOf("Pellmoor", "Quillan")
        val request = SavePartyRequest(mine.toString(), "kalos-the-guardian", others, difficulty = "EXTREME")
        return createParty(userId, mine, kalos, request, now)
    }

    private fun tick(
        partyId: Uuid,
        cleared: Boolean,
    ) = setPartyClear(findParty(partyId, userId)!!, kalos, "WEEKLY", cleared, Clock.System.now())

    private fun coupons(partyId: Uuid) = lootFor(partyId).filter { it.dropKey == "vestige-of-erion" }

    private fun pickup(partyId: Uuid) = coupons(partyId).single().bundlesBy.associate { it.memberId to it.bundles }

    @Test
    fun `a new party on a boss that drops coupons starts with it on`() {
        transaction {
            assertTrue(findParty(party(), userId)!!.autoAddVestiges)
        }
    }

    @Test
    fun `with the setting off a party clear files nothing, and turning it on files the clear`() {
        transaction {
            val partyId = party()
            setAutoAddVestiges(partyId, false, Clock.System.now())
            tick(partyId, true)
            assertTrue(coupons(partyId).isEmpty())

            setAutoAddVestiges(partyId, true, Clock.System.now())
            assertEquals(1, coupons(partyId).size)
        }
    }

    @Test
    fun `a party clear files the guaranteed coupons split by the Entitled shares`() {
        transaction {
            val partyId = party()
            tick(partyId, true)

            val row = coupons(partyId).single()
            assertEquals(180, row.quantity)
            assertEquals(listOf(2, 2, 2), pickup(partyId).values.toList())
        }
    }

    @Test
    fun `ticking it again files no second row, and un-ticking takes the app's row back`() {
        transaction {
            val partyId = party()
            tick(partyId, true)
            tick(partyId, true)
            assertEquals(1, coupons(partyId).size)

            tick(partyId, false)
            assertTrue(coupons(partyId).isEmpty())
        }
    }

    @Test
    fun `a split somebody saved holds the row against an un-tick`() {
        transaction {
            val partyId = party()
            tick(partyId, true)
            val row = coupons(partyId).single()
            val seats = row.ranThatWeek.map(Uuid::parse)
            setLootBundles(Uuid.parse(row.id), mapOf(seats[0] to 4, seats[1] to 2))

            tick(partyId, false)
            assertEquals(1, coupons(partyId).size)
        }
    }

    @Test
    fun `the pickup copies the last night that was answered`() {
        transaction {
            val partyId = party()
            val now = Clock.System.now()
            val lastWeek = periodStartFor("WEEKLY", now).minus(DatePeriod(days = 7))
            val earlier = addLoot(partyId, LootedDrop(vestigeId(), quantity = 180), kalos, lastWeek, now)
            val seats = findLoot(earlier, partyId)!!.ranThatWeek.map(Uuid::parse)
            setLootBundles(earlier, mapOf(seats[0] to 4, seats[2] to 2))

            tick(partyId, true)

            val thisWeek = coupons(partyId).single { it.droppedOn >= periodStartFor("WEEKLY", now).toString() }
            assertEquals(
                mapOf(seats[0].toString() to 4, seats[2].toString() to 2),
                thisWeek.bundlesBy.associate { it.memberId to it.bundles },
            )
        }
    }

    @Test
    fun `a new Entitled ratio re-files the app's pickup`() {
        transaction {
            val partyId = party()
            tick(partyId, true)
            val party = findParty(partyId, userId)!!
            val request =
                SavePartyRequest(
                    party.characterId,
                    "kalos-the-guardian",
                    listOf("Pellmoor", "Quillan"),
                    shares = mapOf("Pellmoor" to 2),
                    difficulty = "EXTREME",
                )
            saveParty(userId, partyId, request, Clock.System.now())

            val pellmoor = findParty(partyId, userId)!!.members.first { it.name == "Pellmoor" }.id
            assertEquals(1, coupons(partyId).size)
            assertEquals(3, pickup(partyId)[pellmoor])
        }
    }

    @Test
    fun `a mode that drops none takes the app's row back`() {
        transaction {
            val partyId = party()
            tick(partyId, true)
            val now = Clock.System.now()
            val period = periodStartFor("WEEKLY", now)
            setPeriodDifficulty(partyId, period, "CHAOS")
            val own = findParty(partyId, userId)!!.characterId
            clearChanged(Uuid.parse(own), kalos, period, now)

            assertTrue(coupons(partyId).isEmpty())
        }
    }

    @Test
    fun `an odd stack goes to the larger remainder, then the earlier seat`() {
        val (a, b, c) = List(3) { Uuid.random() }
        assertEquals(mapOf(a to 2, b to 1), divideStacks(listOf(a to 1, b to 1), 3))
        assertEquals(mapOf(a to 1, b to 1, c to 1), divideStacks(listOf(a to 1, b to 1, c to 1), 3))
        assertEquals(mapOf(a to 1, b to 2), divideStacks(listOf(a to 1, b to 2), 3))
        assertEquals(mapOf(b to 3), divideStacks(listOf(a to 0, b to 1), 3))
    }
}
