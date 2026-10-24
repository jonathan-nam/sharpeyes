package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
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
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * An arrangement carried with the drop that logs it, against a real Postgres.
 *
 * The claim worth a database to check is the ROLLBACK. A refused arrangement has to take the drop
 * down with it, because the caller asked for one act and is told it failed: leaving the row behind
 * is the landed-but-reported-failed shape that logged one Hard Kaling night twice, and here it would
 * be worse, since the drop that survived would be one nobody had answered for.
 *
 * The arrangement RULES themselves are bundlesRefusal's and are not re-tested here. What this covers
 * is that the add reaches them at all, and what happens to the insert when they refuse.
 */
class AddLootBundlesTest {
    private val userId = "user_test_add_bundles_1"
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
        // A local, not the property: inside deleteWhere {} a bare `userId` binds to the COLUMN and
        // the predicate would be true of every row. See PartyLootTest.
        val owners = listOf(userId)
        transaction {
            VestigeSettlement.deleteWhere { VestigeSettlement.userId inList owners }
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /**
     * Your character plus two others. Hard Limbo drops 60 coupons in 3 stacks, one per seat.
     *
     * The difficulty is not decoration: the stack count is per (boss, difficulty, drop), so a config
     * that has not said which mode it runs has no count to check an arrangement against and every
     * one of them is refused for that rather than for what it says.
     */
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

    private fun addCoupons(partyId: Uuid): Uuid =
        addLoot(
            partyId,
            LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 60),
            bossIdForKey("limbo"),
            dropped,
            Clock.System.now(),
        )

    @Test
    fun `a drop can be logged with who picked up which stacks`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addCoupons(partyId)
            val stacks = party.members.associate { it.id to 1 }

            addedBundles(lootId, partyId, stacks)

            val stored = findLoot(lootId, partyId)!!
            assertEquals(3, stored.bundles)
            assertEquals(stacks, stored.bundlesBy.associate { it.memberId to it.bundles })
        }
    }

    @Test
    fun `a drop logged without one is left unanswered, exactly as it was before`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addCoupons(partyId)

            addedBundles(lootId, partyId, null)
            assertTrue(findLoot(lootId, partyId)!!.bundlesBy.isEmpty())

            // Empty says the same thing as absent, and is how "nobody has said" is expressed.
            addedBundles(lootId, partyId, emptyMap())
            assertTrue(findLoot(lootId, partyId)!!.bundlesBy.isEmpty())
        }
    }

    @Test
    fun `an arrangement that does not add up takes the drop down with it`() {
        // Deliberately NOT inside an outer transaction: the rollback IS the claim, and a nested
        // transaction {} would join the outer one and roll back the setup with it.
        val party = transaction { trio() }
        val partyId = Uuid.parse(party.id)
        val steve = party.members.first { it.name == "Steve" }

        val refused =
            assertFailsWith<BundlesRefused> {
                transaction {
                    addedBundles(addCoupons(partyId), partyId, mapOf(steve.id to 1))
                }
            }
        assertTrue(refused.reason.contains("add up to the 3"))

        // The drop is gone too. This is the whole point of carrying the arrangement with it.
        assertEquals(0, transaction { lootFor(partyId).size })
    }

    @Test
    fun `a stack given to somebody outside the party takes the drop down too`() {
        val party = transaction { trio() }
        val partyId = Uuid.parse(party.id)

        assertFailsWith<BundlesRefused> {
            transaction {
                addedBundles(addCoupons(partyId), partyId, mapOf(Uuid.random().toString() to 3))
            }
        }
        assertEquals(0, transaction { lootFor(partyId).size })
    }

    @Test
    fun `a memberId that is not an id at all is refused before anything is written`() {
        val party = transaction { trio() }
        val partyId = Uuid.parse(party.id)

        assertFailsWith<BundlesRefused> {
            transaction { addedBundles(addCoupons(partyId), partyId, mapOf("not-a-uuid" to 3)) }
        }
        assertEquals(0, transaction { lootFor(partyId).size })
    }

    @Test
    fun `a night whose books have closed is no longer answerable`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addCoupons(partyId)

            // Open, so the arrangement is still a question somebody can answer.
            assertEquals(false, settledAlready(lootId))

            closeBooksOver(lootId)

            // The settlement was made against who held what. Changing that afterwards would move a
            // figure somebody has already been paid against.
            assertTrue(settledAlready(lootId))
        }
    }

    /** One act of closing a holder's books over a drop, as VestigeSettlementRoutes files it. */
    private fun closeBooksOver(lootId: Uuid) {
        val settlementId = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        VestigeSettlement.insert {
            it[VestigeSettlement.id] = settlementId
            it[VestigeSettlement.userId] = owner
            it[holderKind] = "CHARACTER"
            it[characterName] = "steve"
            it[unpaid] = 0
            it[settledAt] = now
            it[createdAt] = now
        }
        VestigeSettlementLoot.insert {
            it[VestigeSettlementLoot.settlementId] = settlementId
            it[VestigeSettlementLoot.lootId] = lootId
        }
    }
}
