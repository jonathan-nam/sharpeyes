package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.isPerMember
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
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
 * What a Heroic pool does instead of selling.
 *
 * Nothing in a Heroic world can change hands, so the whole meso ledger (the sale, the split, the
 * payout rows, the Wallet) has nothing to answer, and the pool had no product at all: the only
 * thing a drop row offered was Remove. The party still has to decide who takes each shared drop.
 *
 * So `taken_by_member_id` is the Heroic axis of `sold_at`, and these pin the three ways getting it
 * wrong would be silent: a taken drop still counted as work to do, a sale recorded as a take (which
 * loses a payout the party is owed), and a take credited to somebody who was not there.
 */
class HeroicLootTest {
    private val userId = "user_test_heroic_1"
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
        // Held in a local: inside deleteWhere {} the table is the receiver, so a bare `userId` binds
        // to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owner = userId
        transaction {
            Party.deleteWhere { Party.userId eq owner }
            Characters.deleteWhere { Characters.userId eq owner }
            Screenshots.deleteWhere { Screenshots.userId eq owner }
        }
    }

    /** Your character plus two others, in [world]. Three seats, yours first. */
    private fun trio(world: String = WORLD_HEROIC): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"))
        return findParty(createParty(userId, mine, bossIdForKey("limbo")!!, request, now), userId)!!
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
    fun `a drop somebody took names them, and stops being pending`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val steve = party.members.first { it.name == "Steve" }

            assertEquals(STATUS_PENDING, findLoot(lootId, partyId)!!.status)
            assertEquals(1, lootCountsFor(listOf(partyId), null)[partyId]!!.pending)

            setLootTakenBy(lootId, Uuid.parse(steve.id), Clock.System.now())

            val after = findLoot(lootId, partyId)!!
            assertEquals(STATUS_TAKEN, after.status)
            assertEquals(steve.id, after.takenByMemberId)
            // The card would otherwise show work the party had already finished, for ever: there is
            // no sale coming to clear it.
            val counts = lootCountsFor(listOf(partyId), null)[partyId]!!
            assertEquals(0, counts.pending)
            assertEquals(1, counts.settled)
        }
    }

    @Test
    fun `putting a drop back makes it pending again`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val steve = party.members.first { it.name == "Steve" }

            setLootTakenBy(lootId, Uuid.parse(steve.id), Clock.System.now())
            setLootTakenBy(lootId, null, Clock.System.now())

            val after = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PENDING, after.status)
            assertNull(after.takenByMemberId)
            assertEquals(1, lootCountsFor(listOf(partyId), null)[partyId]!!.pending)
        }
    }

    @Test
    fun `a nothing-owed take is refused where the drop could have been sold`() {
        transaction {
            val party = trio(WORLD_INTERACTIVE)
            val lootId = addGrindstone(party)
            val loot = findLoot(lootId, Uuid.parse(party.id))!!
            val steve = party.members.first { it.name == "Steve" }

            // The dangerous one. In a trading world this drop is a pot two other seats are owed a
            // share of, and filing it as "Steve took it" would take it off the pending list with
            // nobody owed anything. The party stops being paid and the pool looks tidier for it.
            assertNotNull(takenRefusal(steve.id, loot.ranThatWeek, canSell = true, sold = false))
            assertNull(takenRefusal(steve.id, loot.ranThatWeek, canSell = false, sold = false))
        }
    }

    @Test
    fun `only somebody who ran that week can have taken it`() {
        transaction {
            val party = trio()
            val loot = findLoot(addGrindstone(party), Uuid.parse(party.id))!!

            // A seat that exists but was not on the roster the week this fell could not have bent
            // down for it. Checked against the drop's own ranThatWeek, which is the list the picker
            // offers, so what is accepted and what is offered cannot drift apart.
            assertNotNull(takenRefusal(Uuid.random().toString(), loot.ranThatWeek, canSell = false, sold = false))
            // Null is "put it back in the pool", not a seat, so it is not measured against anybody.
            assertNull(takenRefusal(null, loot.ranThatWeek, canSell = false, sold = false))
        }
    }

    @Test
    fun `nobody takes an instanced drop, because everyone who ran has one`() {
        transaction {
            val party = trio()
            val loot = findLoot(addGrindstone(party), Uuid.parse(party.id))!!
            val steve = party.members.first { it.name == "Steve" }

            // A Heroic Chaos Kalos night hands each member their own 2 tokens. Filing one as "Steve
            // took it" hands over a copy the party never held, and takenTally then counts the whole
            // quantity against Steve, which moves whose turn it is next. The pool hides the button;
            // this is what makes hiding it a rule, the same as canSell above.
            assertNotNull(
                takenRefusal(
                    steve.id,
                    loot.ranThatWeek,
                    canSell = false,
                    sold = false,
                    instanced = true,
                ),
            )
            // Putting it back is always allowed, including for a row recorded before this refusal
            // existed. Otherwise a mistake made under the old rule could never be undone.
            assertNull(
                takenRefusal(
                    null,
                    loot.ranThatWeek,
                    canSell = false,
                    sold = false,
                    instanced = true,
                ),
            )
            // And the pooled control, so this cannot pass by every take being refused.
            assertNull(
                takenRefusal(
                    steve.id,
                    loot.ranThatWeek,
                    canSell = false,
                    sold = false,
                    instanced = false,
                ),
            )
        }
    }

    @Test
    fun `a drop is instanced in the world it says it is`() {
        // The one rule, read the way the route reads it. HEROIC means pooled on Interactive and one
        // each on Heroic, which is why the world is a parameter and not an assumption.
        assertTrue(isPerMember("ALWAYS", WORLD_INTERACTIVE))
        assertTrue(isPerMember("ALWAYS", WORLD_HEROIC))
        assertTrue(isPerMember("HEROIC", WORLD_HEROIC))
        assertFalse(isPerMember("HEROIC", WORLD_INTERACTIVE))
        assertFalse(isPerMember(null, WORLD_HEROIC))
        assertFalse(isPerMember(null, WORLD_INTERACTIVE))
    }

    @Test
    fun `a sold drop cannot also be taken`() {
        transaction {
            val party = trio()
            val loot = findLoot(addGrindstone(party), Uuid.parse(party.id))!!
            val steve = party.members.first { it.name == "Steve" }

            // Two economies for one fact. The database refuses it too
            // (party_loot_sold_or_taken); this is the refusal that says why rather than throwing.
            assertNotNull(takenRefusal(steve.id, loot.ranThatWeek, canSell = false, sold = true))
        }
    }
}
