package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.bosses.setBossClearByHand
import com.sharpeyes.backend.bosses.upsertBossClears
import com.sharpeyes.backend.characters.writeTokenCount
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.db.TokenClearAmount
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.findParty
import com.sharpeyes.backend.parties.saveParty
import com.sharpeyes.backend.parties.setPartyClear
import com.sharpeyes.backend.parties.setSoloDifficulty
import com.sharpeyes.backend.services.DetectedBossClear
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
import kotlin.time.Clock
import kotlin.time.Duration.Companion.seconds
import kotlin.uuid.Uuid

/** Boss clears adding Eternal pieces to the inventory, against a real Postgres. */
class PieceSyncTest {
    private val userId = "user_test_piece_sync_1"

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
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    // --- the grid ------------------------------------------------------------------------------

    /**
     * boss -> difficulty -> world -> (item, count). Jonathan's validated table, by hand, so a change
     * to catalog/items.yaml has to be made twice to pass.
     */
    private val grid =
        mapOf(
            "kalos-the-guardian" to
                mapOf(
                    "EASY" to both("kalos-token", 0, 0),
                    "NORMAL" to both("kalos-residual-determination-fragment", 3, 2),
                    "CHAOS" to both("kalos-token", 5, 2),
                    "EXTREME" to both("kalos-token", 14, 3),
                ),
            "kaling" to
                mapOf(
                    "EASY" to both("ferocious-entanglement-ring-fragment", 1, 1),
                    "NORMAL" to both("ferocious-entanglement-ring-fragment", 5, 2),
                    "HARD" to both("ferocious-beast-ring", 7, 2),
                    "EXTREME" to both("ferocious-beast-ring", 18, 3),
                ),
            "first-adversary" to
                mapOf(
                    "EASY" to both("echo-ancient-resolve", 0, 0),
                    "NORMAL" to both("whisper-ancient-resolve", 4, 2),
                    "HARD" to both("echo-ancient-resolve", 6, 2),
                    "EXTREME" to both("echo-ancient-resolve", 16, 3),
                ),
            "malefic-star" to
                mapOf(
                    "NORMAL" to both("blissful-fantasy-fragment", 6, 2),
                    "HARD" to both("blissful-fantasy-shard", 18, 2),
                ),
            "limbo" to mapOf("NORMAL" to both("distorted-ambition", 1, 1), "HARD" to both("distorted-ambition", 2, 2)),
            "baldrix" to
                mapOf("NORMAL" to both("trace-eternal-loyalty", 1, 1), "HARD" to both("trace-eternal-loyalty", 2, 2)),
            "jupiter" to
                mapOf(
                    "NORMAL" to both("lingering-twisted-desire", 1, 1),
                    "HARD" to both("lingering-twisted-desire", 2, 2),
                ),
        )

    private fun both(
        item: String,
        interactive: Int,
        heroic: Int,
    ) = mapOf(WORLD_INTERACTIVE to (item to interactive), WORLD_HEROIC to (item to heroic))

    @Test
    fun `every boss and difficulty seeds the validated count, and nothing else is seeded`() {
        val seeded =
            transaction {
                TokenClearAmount
                    .innerJoin(BossCatalog)
                    .innerJoin(TokenCatalog)
                    .selectAll()
                    .groupBy { it[BossCatalog.bossKey] }
                    .mapValues { (_, rows) ->
                        rows.groupBy { it[TokenClearAmount.difficulty] }.mapValues { (_, ofMode) ->
                            ofMode.associate {
                                it[TokenClearAmount.world] to
                                    (it[TokenCatalog.visionKey] to it[TokenClearAmount.quantity])
                            }
                        }
                    }
            }
        assertEquals(grid, seeded)
    }

    @Test
    fun `only the four big bosses pool, and only in Interactive`() {
        val pooled =
            transaction {
                TokenClearAmount
                    .innerJoin(BossCatalog)
                    .selectAll()
                    .filter { it[TokenClearAmount.pooled] }
                    .map { it[BossCatalog.bossKey] to it[TokenClearAmount.world] }
                    .toSet()
            }
        assertEquals(
            setOf(
                "kalos-the-guardian",
                "kaling",
                "first-adversary",
                "malefic-star",
            ).map { it to WORLD_INTERACTIVE }.toSet(),
            pooled,
        )
    }

    // --- helpers -------------------------------------------------------------------------------

    private fun character(
        world: String = WORLD_INTERACTIVE,
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
            it[name] = "Husky"
            it[worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun solo(
        characterId: Uuid,
        boss: String,
        difficulty: String,
    ) {
        val bossId = bossIdForKey(boss)!!
        setSoloDifficulty(userId, characterId, bossId, "WEEKLY", difficulty, Clock.System.now())
    }

    private fun party(
        characterId: Uuid,
        boss: String,
        difficulty: String,
    ): Uuid =
        createParty(
            userId,
            characterId,
            bossIdForKey(boss)!!,
            SavePartyRequest(characterId.toString(), boss, listOf("Steve"), difficulty = difficulty),
            Clock.System.now(),
        )

    private fun tick(
        characterId: Uuid,
        boss: String,
        cleared: Boolean = true,
    ) = setBossClearByHand(userId, characterId, boss, cleared, Clock.System.now())

    private fun tokenId(key: String) =
        TokenCatalog.selectAll().where { TokenCatalog.visionKey eq key }.single()[TokenCatalog.id]

    /** What the inventory holds of [key]. No row reads as 0, which is how the grid draws it. */
    private fun held(
        characterId: Uuid,
        key: String,
    ): Int =
        CharacterTokenCount
            .selectAll()
            .where {
                (CharacterTokenCount.characterId eq characterId) and
                    (CharacterTokenCount.tokenCatalogId eq tokenId(key))
            }.firstOrNull()
            ?.get(CharacterTokenCount.quantity) ?: 0

    private fun gaps() = pieceSyncGapsFor(userId, Clock.System.now()).map { it.bossKey to it.reason }

    // --- ticking -------------------------------------------------------------------------------

    @Test
    fun `ticking adds the pieces once, and unticking takes exactly them back`() {
        transaction {
            val me = character()
            solo(me, "kalos-the-guardian", "EXTREME")
            writeTokenCount(me, tokenId("kalos-token"), 3)

            tick(me, "kalos-the-guardian")
            assertEquals(17, held(me, "kalos-token"))
            tick(me, "kalos-the-guardian")
            assertEquals(17, held(me, "kalos-token"), "ticked twice, added once")

            tick(me, "kalos-the-guardian", cleared = false)
            assertEquals(3, held(me, "kalos-token"))
            tick(me, "kalos-the-guardian")
            assertEquals(17, held(me, "kalos-token"))
        }
    }

    @Test
    fun `turning the sync off and on again never adds or removes a piece`() {
        transaction {
            val me = character()
            solo(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertEquals(14, held(me, "kalos-token"))

            setPieceSync(userId, false)
            assertEquals(14, held(me, "kalos-token"))
            setPieceSync(userId, true)
            assertEquals(14, held(me, "kalos-token"))

            // A clear ticked while it was off is not added when it comes back on.
            setPieceSync(userId, false)
            solo(me, "kaling", "HARD")
            tick(me, "kaling")
            setPieceSync(userId, true)
            assertEquals(0, held(me, "ferocious-beast-ring"))
            assertEquals(14, held(me, "kalos-token"))
        }
    }

    @Test
    fun `nothing moves while the sync is off`() {
        transaction {
            val me = character(sync = false)
            solo(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertEquals(0, held(me, "kalos-token"))
            assertEquals(emptyList(), gaps())
        }
    }

    @Test
    fun `a mode that drops none adds nothing and is not a gap`() {
        transaction {
            val me = character()
            solo(me, "kalos-the-guardian", "EASY")
            tick(me, "kalos-the-guardian")
            assertEquals(0, held(me, "kalos-token"))
            assertEquals(emptyList(), gaps())
        }
    }

    @Test
    fun `a clear with no mode named adds nothing and says so, then fills when one is named`() {
        transaction {
            val me = character()
            tick(me, "limbo")
            assertEquals(0, held(me, "distorted-ambition"))
            assertEquals(listOf("limbo" to PieceSyncGap.NO_DIFFICULTY), gaps())

            solo(me, "limbo", "HARD")
            assertEquals(2, held(me, "distorted-ambition"))
            assertEquals(emptyList(), gaps())
        }
    }

    // --- difficulty ----------------------------------------------------------------------------

    @Test
    fun `Hard Kaling corrected to Normal swaps the rings for fragments`() {
        transaction {
            val me = character()
            solo(me, "kaling", "HARD")
            tick(me, "kaling")
            assertEquals(7, held(me, "ferocious-beast-ring"))

            solo(me, "kaling", "NORMAL")
            assertEquals(0, held(me, "ferocious-beast-ring"))
            assertEquals(5, held(me, "ferocious-entanglement-ring-fragment"))

            tick(me, "kaling", cleared = false)
            assertEquals(0, held(me, "ferocious-entanglement-ring-fragment"))
        }
    }

    @Test
    fun `a party's difficulty edit re-files this week's pieces too`() {
        transaction {
            val me = character(world = WORLD_HEROIC)
            val partyId = party(me, "kaling", "HARD")
            setPartyClear(findParty(partyId, userId)!!, bossIdForKey("kaling")!!, "WEEKLY", true, Clock.System.now())
            assertEquals(2, held(me, "ferocious-beast-ring"))

            saveParty(
                userId,
                partyId,
                SavePartyRequest(me.toString(), "kaling", listOf("Steve"), difficulty = "NORMAL"),
                Clock.System.now(),
            )
            assertEquals(0, held(me, "ferocious-beast-ring"))
            assertEquals(2, held(me, "ferocious-entanglement-ring-fragment"))

            setPartyClear(findParty(partyId, userId)!!, bossIdForKey("kaling")!!, "WEEKLY", false, Clock.System.now())
            assertEquals(0, held(me, "ferocious-entanglement-ring-fragment"))
        }
    }

    // --- world and party -----------------------------------------------------------------------

    @Test
    fun `Heroic gives each member their own count, in a party or not`() {
        transaction {
            val me = character(world = WORLD_HEROIC)
            party(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            assertEquals(3, held(me, "kalos-token"))
        }
    }

    @Test
    fun `an Interactive party's pooled pile waits for the party to add it`() {
        transaction {
            val me = character()
            party(me, "kalos-the-guardian", "EXTREME")
            tick(me, "kalos-the-guardian")
            // Added on Party View, like coupons. PiecePileTest covers adding it.
            assertEquals(0, held(me, "kalos-token"))
            assertEquals(listOf("kalos-the-guardian" to PieceSyncGap.PARTY_LOOT), gaps())
        }
    }

    @Test
    fun `an Interactive party still gets a drop every member receives`() {
        transaction {
            val me = character()
            party(me, "limbo", "HARD")
            tick(me, "limbo")
            assertEquals(2, held(me, "distorted-ambition"))
        }
    }

    // --- restated counts -----------------------------------------------------------------------

    @Test
    fun `a count typed after the tick still loses the credit when the tick is undone`() {
        transaction {
            val me = character()
            solo(me, "kaling", "HARD")
            writeTokenCount(me, tokenId("ferocious-beast-ring"), 10)
            tick(me, "kaling")
            assertEquals(17, held(me, "ferocious-beast-ring"))

            // Redeemed ten, typed what is left.
            writeTokenCount(me, tokenId("ferocious-beast-ring"), 7)
            tick(me, "kaling", cleared = false)
            assertEquals(0, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a count below what was added is left alone, and the clear cannot add twice`() {
        transaction {
            val me = character()
            solo(me, "kaling", "HARD")
            tick(me, "kaling")
            writeTokenCount(me, tokenId("ferocious-beast-ring"), 4)

            tick(me, "kaling", cleared = false)
            assertEquals(4, held(me, "ferocious-beast-ring"))
            tick(me, "kaling")
            assertEquals(4, held(me, "ferocious-beast-ring"))
        }
    }

    private fun screenshot(characterId: Uuid): Uuid {
        val id = Uuid.random()
        val owner = userId
        Screenshots.insert {
            it[Screenshots.id] = id
            it[Screenshots.userId] = owner
            it[Screenshots.characterId] = characterId
            it[uploadedAt] = Clock.System.now()
        }
        return id
    }

    /** What ingestion does with a capture: the inventory first, then the planner. */
    private fun capture(
        characterId: Uuid,
        ring: Int?,
        kalingCleared: Boolean,
        complete: Boolean = false,
    ) {
        val shot = screenshot(characterId)
        val at = Clock.System.now() + 1.seconds
        if (ring != null) {
            CharacterTokenCount.deleteWhere {
                (CharacterTokenCount.characterId eq characterId) and
                    (CharacterTokenCount.tokenCatalogId eq tokenId("ferocious-beast-ring"))
            }
            CharacterTokenCount.insert {
                it[CharacterTokenCount.characterId] = characterId
                it[tokenCatalogId] = tokenId("ferocious-beast-ring")
                it[quantity] = ring
                it[capturedAt] = at
                it[sourceScreenshotId] = shot
            }
        }
        upsertBossClears(characterId, listOf(DetectedBossClear("kaling", kalingCleared)), shot, at, complete)
    }

    @Test
    fun `a capture reading the inventory and the clear together does not count the drop twice`() {
        transaction {
            val me = character()
            solo(me, "kaling", "HARD")
            capture(me, ring = 7, kalingCleared = true)
            assertEquals(7, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a planner-only capture adds the pieces`() {
        transaction {
            val me = character()
            solo(me, "kaling", "HARD")
            capture(me, ring = null, kalingCleared = true)
            assertEquals(7, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `once a capture has read the count, undoing the tick leaves it`() {
        transaction {
            val me = character()
            solo(me, "kaling", "HARD")
            tick(me, "kaling")
            capture(me, ring = 9, kalingCleared = true)
            tick(me, "kaling", cleared = false)
            assertEquals(9, held(me, "ferocious-beast-ring"))
        }
    }

    @Test
    fun `a clear ticked before the sync was on is listed rather than added`() {
        transaction {
            val me = character(sync = false)
            solo(me, "limbo", "HARD")
            tick(me, "limbo")
            Users.update({ Users.id eq userId }) { it[syncPiecesFromClears] = true }
            assertEquals(0, held(me, "distorted-ambition"))
            assertEquals(listOf("limbo" to PieceSyncGap.BEFORE_SYNC), gaps())
        }
    }
}
