package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.bosses.setBossClearByHand
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
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
 * What lands in the inventory as clears, piles, parties and difficulties change, against a real Postgres.
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

    /** What Party View's Add/Save does: write the pile, then bring every inventory it touches along. */
    private fun record(
        me: Uuid,
        partyId: Uuid,
        boss: String,
        vararg takes: Pair<String, Int>,
    ) {
        val now = Clock.System.now()
        val before = seatedCharacters(partyId, week())
        val edit = PileEdit(takes.sumOf { it.second }, takes.associate { (name, n) -> seat(partyId, name) to n })
        assertNull(editPile(partyId, week(), edit, now))
        syncSeated(before + seatedCharacters(partyId, week()) + me, boss(boss), week(), now)
    }

    /** What Party View's Remove does. */
    private fun remove(
        me: Uuid,
        partyId: Uuid,
        boss: String,
    ) {
        val now = Clock.System.now()
        val before = seatedCharacters(partyId, week())
        removePile(partyId, week())
        syncSeated(before + me, boss(boss), week(), now)
    }

    private fun cleared(
        me: Uuid,
        boss: String,
    ) = BossClear
        .selectAll()
        .where { (BossClear.characterId eq me) and (BossClear.bossCatalogId eq boss(boss)) }
        .any { it[BossClear.cleared] }

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
                        ) to it[TokenClearAmount.quantity]
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

    // --- Interactive parties: added by hand, like coupons --------------------------------------

    @Test
    fun `a party clear adds nothing on its own, and says the pieces are not added`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertNull(pile(partyId))
            assertEquals(0, held(me, "kalos-token"))
            assertEquals(
                listOf("kalos-the-guardian" to PieceSyncGap.PARTY_LOOT),
                pieceSyncGapsFor(userId, Clock.System.now()).map { it.bossKey to it.reason },
            )
        }
    }

    @Test
    fun `adding the pile ticks the clear and adds this character's take`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "EXTREME")
            record(me, partyId, "kalos-the-guardian", ownName(me) to 7, "Steve" to 4, "Bob" to 3)

            assertTrue(cleared(me, "kalos-the-guardian"))
            assertEquals(14, pile(partyId)!!.total)
            assertEquals(7, held(me, "kalos-token"))
            assertEquals(emptyList(), pieceSyncGapsFor(userId, Clock.System.now()))
        }
    }

    @Test
    fun `correcting the pile moves the count, and removing it takes it back`() {
        transaction {
            val me = character()
            val partyId = party(me, "kaling", "HARD")
            record(me, partyId, "kaling", ownName(me) to 3, "Steve" to 2, "Bob" to 2)
            assertEquals(3, held(me, "ferocious-beast-ring"))

            record(me, partyId, "kaling", ownName(me) to 5, "Steve" to 2, "Bob" to 0)
            assertEquals(5, held(me, "ferocious-beast-ring"))
            assertEquals(mapOf(ownName(me) to 5, "Steve" to 2, "Bob" to 0), takes(partyId))

            remove(me, partyId, "kaling")
            assertNull(pile(partyId))
            assertEquals(0, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a pile added is a record, so changing the config's mode does not rewrite it`() {
        transaction {
            val me = character()
            val partyId = party(me, "kaling", "HARD")
            record(me, partyId, "kaling", ownName(me) to 3, "Steve" to 2, "Bob" to 2)

            saveParty(userId, partyId, request(me, "kaling", "NORMAL"), Clock.System.now())
            assertEquals("HARD", pile(partyId)!!.difficulty)
            assertEquals(3, held(me, "ferocious-beast-ring"))
            assertEquals(0, held(me, "ferocious-entanglement-ring-fragment"))

            // The individual config's difficulty is the party's, last writer wins, and still
            // leaves the recorded week alone.
            solo(me, "kaling", "EXTREME")
            assertEquals("EXTREME", findParty(partyId, userId)!!.difficulty)
            assertEquals(3, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a new pile is of the token the config's mode drops`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "NORMAL", members = listOf("Steve"))
            record(me, partyId, "kalos-the-guardian", ownName(me) to 2, "Steve" to 1)
            assertEquals(2, held(me, "kalos-residual-determination-fragment"))
            assertEquals(0, held(me, "kalos-token"))
        }
    }

    @Test
    fun `unticking the clear keeps the pieces the pile records`() {
        transaction {
            val me = character()
            val partyId = party(me, "first-adversary", "HARD", members = listOf("Steve"))
            record(me, partyId, "first-adversary", ownName(me) to 3, "Steve" to 3)
            tick(me, "first-adversary", cleared = false)
            assertEquals(3, held(me, "echo-ancient-resolve"))
        }
    }

    @Test
    fun `a pile that splits a stack or does not add up is refused`() {
        transaction {
            val me = character()
            val partyId = party(me, "malefic-star", "HARD", members = listOf("Steve"))
            val mine = seat(partyId, ownName(me))
            val steve = seat(partyId, "Steve")
            val now = Clock.System.now()

            assertNotNull(editPile(partyId, week(), PileEdit(18, mapOf(mine to 10, steve to 8)), now))
            assertNotNull(editPile(partyId, week(), PileEdit(18, mapOf(mine to 9, steve to 6)), now))
            assertNull(pile(partyId))

            record(me, partyId, "malefic-star", ownName(me) to 9, "Steve" to 9)
            assertEquals(9, held(me, "blissful-fantasy-shard"))
        }
    }

    @Test
    fun `deleting a party with pieces added keeps them, the way a drop is kept`() {
        transaction {
            val me = character()
            val partyId = party(me, "kaling", "EXTREME", members = listOf("Steve"))
            record(me, partyId, "kaling", ownName(me) to 9, "Steve" to 9)

            retireOrDeleteParty(partyId, userId, Clock.System.now())
            assertNotNull(pile(partyId))
            assertEquals(9, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `deleting a party with nothing added takes back what its clear gave`() {
        transaction {
            val me = character(world = WORLD_HEROIC)
            val partyId = party(me, "kaling", "EXTREME", members = listOf("Steve"))
            tick(me, "kaling")
            assertEquals(3, held(me, "ferocious-beast-ring"))

            retireOrDeleteParty(partyId, userId, Clock.System.now())
            assertEquals(0, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a temp party over a solo Normal Kalos takes the solo pieces back until the party adds its own`() {
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

            record(me, soloId, "kalos-the-guardian", ownName(me) to 3, "Steve" to 2)
            assertEquals(3, held(me, "kalos-token"))
        }
    }

    @Test
    fun `a roster change or a skip does not rewrite a recorded week`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "EXTREME", members = listOf("Steve"))
            record(me, partyId, "kalos-the-guardian", ownName(me) to 7, "Steve" to 7)

            saveWeekRoster(
                partyId,
                me,
                week(),
                listOf("Steve", "Guest"),
                SeatContext(userId, emptyMap(), Clock.System.now()),
            )
            setRunsInPeriod(partyId, oneOff = false, week(), runs = false, now = Clock.System.now())
            assertEquals(7, held(me, "kalos-token"))
        }
    }

    @Test
    fun `your alt seated in the pile gets its take without its own tick`() {
        transaction {
            val me = character()
            val alt = character(name = "Altling")
            val partyId = party(me, "kalos-the-guardian", "EXTREME", members = listOf("Altling", "Steve"))
            record(me, partyId, "kalos-the-guardian", ownName(me) to 5, "Altling" to 5, "Steve" to 4)
            assertEquals(5, held(me, "kalos-token"))
            assertEquals(5, held(alt, "kalos-token"))
        }
    }

    @Test
    fun `a pile never reaches party_loot, so never the Drop Log, a sale or a settlement`() {
        transaction {
            val me = character()
            val partyId = party(me, "kalos-the-guardian", "CHAOS")
            record(me, partyId, "kalos-the-guardian", ownName(me) to 2, "Steve" to 2, "Bob" to 1)
            assertTrue(PartyLoot.selectAll().where { PartyLoot.partyId eq partyId }.empty())
        }
    }

    @Test
    fun `with the sync off a pile is recorded and the inventory is left alone`() {
        transaction {
            val me = character(sync = false)
            val partyId = party(me, "kalos-the-guardian", "EXTREME")
            record(me, partyId, "kalos-the-guardian", ownName(me) to 14, "Steve" to 0, "Bob" to 0)
            assertNotNull(pile(partyId))
            assertEquals(0, held(me, "kalos-token"))
        }
    }

    // --- Heroic --------------------------------------------------------------------------------

    @Test
    fun `Heroic gives everybody their own count, and has no pile to add`() {
        transaction {
            val me = character(world = WORLD_HEROIC)
            val partyId = party(me, "kalos-the-guardian", "EXTREME", members = listOf("Steve"))
            tick(me, "kalos-the-guardian")
            assertEquals(3, held(me, "kalos-token"))

            val edit = PileEdit(14, mapOf(seat(partyId, ownName(me)) to 14))
            assertNotNull(editPile(partyId, week(), edit, Clock.System.now()))
            assertNull(pile(partyId))
        }
    }
}
