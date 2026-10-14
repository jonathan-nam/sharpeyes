package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.bosses.setBossClearByHand
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyPiecePile
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.db.TokenClearAmount
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SeatContext
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.findParty
import com.sharpeyes.backend.parties.piecePilesFor
import com.sharpeyes.backend.parties.retireOrDeleteParty
import com.sharpeyes.backend.parties.saveParty
import com.sharpeyes.backend.parties.saveWeekRoster
import com.sharpeyes.backend.parties.setRunsInPeriod
import com.sharpeyes.backend.parties.setSoloDifficulty
import com.sharpeyes.backend.parties.takeOverParty
import com.sharpeyes.backend.parties.takesOverConfig
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
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
 * What lands in the inventory as clears, parties and difficulties change, against a real Postgres.
 *
 * Every case drives the same functions the routes call, then reads the inventory itself.
 */
class PiecePileTest {
    private val userId = "user_test_piece_pile_1"
    private var names = 0

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
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    // --- helpers -------------------------------------------------------------------------------

    private fun character(
        world: String = WORLD_INTERACTIVE,
        name: String = "Husky${names++}",
        sync: Boolean = true,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, world)
        Users.update({ Users.id eq userId }) { it[syncPiecesFromClears] = sync }
        val id = Uuid.random()
        val owner = userId
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun boss(key: String) = bossIdForKey(key)!!

    private fun week() = periodStartFor(WEEKLY_CADENCE, Clock.System.now())

    private fun solo(
        me: Uuid,
        boss: String,
        difficulty: String,
    ) = setSoloDifficulty(userId, me, boss(boss), "WEEKLY", difficulty, Clock.System.now())

    private fun request(
        me: Uuid,
        boss: String,
        difficulty: String?,
        members: List<String> = listOf("Steve", "Bob"),
        pieceShares: Map<String, Int> = emptyMap(),
        oneOff: Boolean = false,
    ) = SavePartyRequest(
        me.toString(),
        boss,
        members,
        pieceShares = pieceShares,
        difficulty = difficulty,
        oneOff = oneOff,
    )

    private fun party(
        me: Uuid,
        boss: String,
        difficulty: String,
        members: List<String> = listOf("Steve", "Bob"),
        pieceShares: Map<String, Int> = emptyMap(),
    ): Uuid =
        createParty(userId, me, boss(boss), request(me, boss, difficulty, members, pieceShares), Clock.System.now())

    private fun tick(
        me: Uuid,
        boss: String,
        cleared: Boolean = true,
    ) = assertTrue(setBossClearByHand(userId, me, boss, cleared, Clock.System.now()))

    private fun tokenId(key: String) =
        TokenCatalog.selectAll().where { TokenCatalog.visionKey eq key }.single()[TokenCatalog.id]

    private fun held(
        me: Uuid,
        key: String,
    ): Int =
        CharacterTokenCount
            .selectAll()
            .where { (CharacterTokenCount.characterId eq me) and (CharacterTokenCount.tokenCatalogId eq tokenId(key)) }
            .firstOrNull()
            ?.get(CharacterTokenCount.quantity) ?: 0

    private fun pile(partyId: Uuid) = piecePilesFor(listOf(partyId), week()).singleOrNull()

    private fun seat(
        partyId: Uuid,
        name: String,
    ): Uuid =
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
            .single()[PartyMember.id]

    /** The pile's takes by seat name. */
    private fun takes(partyId: Uuid): Map<String, Int> {
        val names =
            PartyMember.selectAll().where { PartyMember.partyId eq partyId }.associate {
                it[PartyMember.id].toString() to
                    it[PartyMember.name]
            }
        return pile(partyId)!!.takes.associate { names.getValue(it.memberId) to it.quantity }
    }

    private fun ownName(me: Uuid) = Characters.selectAll().where { Characters.id eq me }.single()[Characters.name]

    // --- the split -----------------------------------------------------------------------------

    @Test
    fun `stacks divide by the ratio in whole stacks, the remainder to the earlier seat`() {
        assertEquals(listOf(7, 7), splitStacks(14, listOf(1, 1)))
        assertEquals(listOf(7, 4, 3), splitStacks(14, listOf(2, 1, 1)))
        assertEquals(listOf(2, 2, 1, 1), splitStacks(6, listOf(1, 1, 1, 1)))
        assertEquals(listOf(0, 5), splitStacks(5, listOf(0, 1)))
        assertEquals(listOf(3, 2), splitStacks(5, listOf(0, 0)))
        // Every split adds back up to what fell, whatever the ratio.
        for (stacks in 0..18) {
            for (weights in listOf(listOf(1, 2, 3), listOf(5, 0, 1, 1), listOf(1), listOf(3, 3, 3, 3, 3, 3))) {
                assertEquals(stacks, splitStacks(stacks, weights).sum(), "$stacks over $weights")
            }
        }
    }

    // --- every boss and difficulty, run alone -------------------------------------------------

    @Test
    fun `a solo clear adds exactly the catalog count for every boss, difficulty and world`() {
        transaction {
            val rows =
                TokenClearAmount
                    .innerJoin(BossCatalog)
                    .innerJoin(TokenCatalog)
                    .selectAll()
                    .map {
                        listOf(
                            it[BossCatalog.bossKey],
                            it[TokenClearAmount.difficulty],
                            it[TokenClearAmount.world],
                            it[TokenCatalog.visionKey],
                        ) to
                            it[TokenClearAmount.quantity]
                    }
            // 7 bosses, 20 difficulties, 2 worlds. A shrunken table would pass a loop over nothing.
            assertEquals(40, rows.size)
            for ((key, count) in rows) {
                val (bossKey, difficulty, world) = key
                val item = key[3]
                val me = character(world = world)
                solo(me, bossKey, difficulty)
                tick(me, bossKey)
                assertEquals(count, held(me, item), "$bossKey $difficulty $world")
                tick(me, bossKey, cleared = false)
                assertEquals(0, held(me, item), "$bossKey $difficulty $world, unticked")
            }
        }
    }

    // --- Interactive parties -------------------------------------------------------------------

    @Test
    fun `a party clear files the pile by the piece ratio and adds this character's take`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "EXTREME", pieceShares = mapOf(ownName(me) to 2))
            tick(me, "kalos-the-guardian")

            assertEquals(14, pile(partyId)!!.total)
            assertEquals(mapOf(ownName(me) to 7, "Steve" to 4, "Bob" to 3), takes(partyId))
            assertEquals(7, held(me, "kalos-token"))

            tick(me, "kalos-the-guardian", cleared = false)
            assertNull(pile(partyId))
            assertEquals(0, held(me, "kalos-token"))
        }
    }

    @Test
    fun `Hard Malefic Star divides in stacks of three`() {
        transaction {
            val me = character()
            val partyId = party(me, "malefic-star", "HARD", members = listOf("Steve", "Bob", "Ann"))
            tick(me, "malefic-star")
            // 6 stacks over 4: 2, 2, 1, 1 stacks.
            assertEquals(mapOf(ownName(me) to 6, "Steve" to 6, "Bob" to 3, "Ann" to 3), takes(partyId))
            assertEquals(6, held(me, "blissful-fantasy-shard"))
        }
    }

    @Test
    fun `changing a party's difficulty re-files the pile and swaps the pieces`() {
        transaction {
            val me = character()
            val partyId = party(me, "kaling", "HARD", pieceShares = mapOf(ownName(me) to 2))
            tick(me, "kaling")
            // 7 over 2:1:1 is 3.5, 1.75, 1.75: the two larger remainders take the spare stacks, so 3, 2, 2.
            assertEquals(3, held(me, "ferocious-beast-ring"))

            saveParty(userId, partyId, request(me, "kaling", "NORMAL"), Clock.System.now())
            // 5 fragments over 2:1:1 is 2, 2, 1 (the ratio sent nothing, so it was kept).
            assertEquals(0, held(me, "ferocious-beast-ring"))
            assertEquals(splitStacks(5, listOf(2, 1, 1))[0], held(me, "ferocious-entanglement-ring-fragment"))
            assertEquals("NORMAL", pile(partyId)!!.difficulty)
        }
    }

    @Test
    fun `the individual config's difficulty is the party's too, last writer wins`() {
        transaction {
            val me = character()
            val partyId = party(me, "kaling", "HARD", members = listOf("Steve"))
            tick(me, "kaling")
            assertEquals(4, held(me, "ferocious-beast-ring"))

            solo(me, "kaling", "EXTREME")
            assertEquals("EXTREME", findParty(partyId, userId)!!.difficulty)
            assertEquals(9, held(me, "ferocious-beast-ring"))

            saveParty(userId, partyId, request(me, "kaling", "HARD", listOf("Steve")), Clock.System.now())
            assertEquals(4, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a corrected pile is the week's record, and nothing re-files it until reset`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertEquals(5, held(me, "kalos-token"))

            val now = Clock.System.now()
            val edit =
                PileEdit(
                    14,
                    mapOf(
                        seat(partyId, ownName(me)) to 10,
                        seat(partyId, "Steve") to 4,
                        seat(partyId, "Bob") to 0,
                    ),
                )
            assertNull(editPile(partyId, week(), edit, now))
            syncSeated(setOf(me), boss("kalos-the-guardian"), week(), now)
            assertEquals(10, held(me, "kalos-token"))

            // A mode change does not touch it.
            saveParty(userId, partyId, request(me, "kalos-the-guardian", "CHAOS"), Clock.System.now())
            assertEquals(10, held(me, "kalos-token"))

            syncSeated(resetPile(partyId, week(), Clock.System.now()), boss("kalos-the-guardian"), week(), now)
            // Chaos is 5 over three seats: 2, 2, 1.
            assertEquals(2, held(me, "kalos-token"))
        }
    }

    @Test
    fun `a correction that does not add up, or splits a stack, is refused`() {
        transaction {
            val me = character()
            val partyId = party(me, "malefic-star", "HARD", members = listOf("Steve"))
            tick(me, "malefic-star")
            val mine = seat(partyId, ownName(me))
            val steve = seat(partyId, "Steve")
            val now = Clock.System.now()

            assertNotNull(editPile(partyId, week(), PileEdit(18, mapOf(mine to 9, steve to 6)), now))
            assertNotNull(editPile(partyId, week(), PileEdit(18, mapOf(mine to 10, steve to 8)), now))
            assertEquals(9, held(me, "blissful-fantasy-shard"))
        }
    }

    @Test
    fun `deleting a party takes its pile and the pieces back`() {
        transaction {
            val me = character()
            val partyId = party(me, "first-adversary", "HARD", members = listOf("Steve"))
            tick(me, "first-adversary")
            assertEquals(3, held(me, "echo-ancient-resolve"))

            retireOrDeleteParty(partyId, userId, Clock.System.now())
            assertEquals(0, held(me, "echo-ancient-resolve"))
            assertTrue(PartyPiecePile.selectAll().where { PartyPiecePile.partyId eq partyId }.empty())
        }
    }

    @Test
    fun `a temp party over a solo Normal Kalos re-files the week at Chaos`() {
        transaction {
            val me = character()
            val soloId = solo(me, "kalos-the-guardian", "NORMAL")
            tick(me, "kalos-the-guardian")
            assertEquals(3, held(me, "kalos-residual-determination-fragment"))

            val now = Clock.System.now()
            val temp = request(me, "kalos-the-guardian", "CHAOS", members = listOf("Steve"), oneOff = true)
            assertTrue(takesOverConfig(soloId, temp, now))
            takeOverParty(userId, soloId, temp, now)

            assertEquals(0, held(me, "kalos-residual-determination-fragment"))
            // Chaos is 5 over two: 3 and 2.
            assertEquals(3, held(me, "kalos-token"))
        }
    }

    @Test
    fun `a temp party that names no difficulty keeps the individual one`() {
        transaction {
            val me = character()
            val soloId = solo(me, "kaling", "HARD")
            tick(me, "kaling")
            assertEquals(7, held(me, "ferocious-beast-ring"))

            val now = Clock.System.now()
            takeOverParty(userId, soloId, request(me, "kaling", null, members = listOf("Steve"), oneOff = true), now)
            assertEquals("HARD", findParty(soloId, userId)!!.difficulty)
            assertEquals(4, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `whoever ran the week divides the pile`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "EXTREME", members = listOf("Steve"))
            tick(me, "kalos-the-guardian")
            assertEquals(7, held(me, "kalos-token"))

            val context = SeatContext(userId, emptyMap(), Clock.System.now())
            saveWeekRoster(partyId, me, week(), listOf("Steve", "Guest"), context)
            // 14 over three: 5, 5, 4.
            assertEquals(5, held(me, "kalos-token"))
        }
    }

    @Test
    fun `a party skipped for the week stops dividing it`() {
        transaction {
            val me = character()
            val partyId = party(me, "kaling", "EXTREME", members = listOf("Steve"))
            tick(me, "kaling")
            assertEquals(9, held(me, "ferocious-beast-ring"))

            setRunsInPeriod(partyId, oneOff = false, week(), runs = false, now = Clock.System.now())
            assertNull(pile(partyId))
            assertEquals(0, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `your alt seated in the party gets its own take`() {
        transaction {
            val me = character()
            val alt = character(name = "Altling")
            val partyId = party(me, "kalos-the-guardian", "EXTREME", members = listOf("Altling", "Steve"))
            tick(me, "kalos-the-guardian")
            tick(alt, "kalos-the-guardian")
            // 14 over three: 5, 5, 4, the alt second.
            assertEquals(5, held(me, "kalos-token"))
            assertEquals(5, held(alt, "kalos-token"))
            assertEquals(5, takes(partyId)["Altling"])
        }
    }

    @Test
    fun `a pile never reaches party_loot, so never the Drop Log, a sale or a settlement`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "CHAOS")
            tick(me, "kalos-the-guardian")
            assertNotNull(pile(partyId))
            assertTrue(PartyLoot.selectAll().where { PartyLoot.partyId eq partyId }.empty())
        }
    }

    @Test
    fun `the pile is filed with the sync off, and the inventory is left alone`() {
        transaction {
            val me = character(sync = false)
            val partyId = party(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertNotNull(pile(partyId))
            assertEquals(0, held(me, "kalos-token"))
        }
    }

    // --- Heroic --------------------------------------------------------------------------------

    @Test
    fun `Heroic has no pile, everybody gets their own count`() {
        transaction {
            val me = character(world = WORLD_HEROIC)
            val partyId = party(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertNull(pile(partyId))
            assertEquals(3, held(me, "kalos-token"))
        }
    }

    @Test
    fun `a Heroic party cannot be given a pile by hand either`() {
        transaction {
            val me = character(world = WORLD_HEROIC)
            val partyId = party(me, "kalos-the-guardian", "EXTREME", members = listOf("Steve"))
            val edit = PileEdit(14, mapOf(seat(partyId, ownName(me)) to 14))
            assertNotNull(editPile(partyId, week(), edit, Clock.System.now()))
            assertNull(pile(partyId))
        }
    }
}
