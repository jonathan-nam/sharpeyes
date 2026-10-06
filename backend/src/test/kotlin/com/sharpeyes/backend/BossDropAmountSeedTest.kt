package com.sharpeyes.backend

import com.sharpeyes.backend.bosses.dropTables
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.DropCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * How many pieces each boss drops, against a real Postgres.
 *
 * Every number here was verified by hand against the game, one difficulty at a time, and they fill
 * the count when a drop is logged. That makes them the kind this repo is most afraid of: a number
 * nobody re-checks because the box was already filled in. So the WHOLE grid is pinned, keyed by
 * (boss, drop, difficulty, world), and compared as one map. A missing row fails as loudly as a
 * wrong one, which a spot check of a few figures would not.
 */
class BossDropAmountSeedTest {
    /** boss -> drop -> difficulty -> world -> pieces. Mirrors catalog/drops.yaml, by hand. */
    private val expected =
        mapOf(
            // One number each, and an INTERACTIVE one: it is the size of the pile the party shares,
            // and Reboot instances its pieces instead of piling them.
            "chosen-seren" to mapOf("vestige-of-erion" to mapOf("EXTREME" to pooled(30))),
            "limbo" to mapOf("vestige-of-erion" to mapOf("HARD" to pooled(60))),
            "kalos-the-guardian" to mapOf("vestige-of-erion" to mapOf("EXTREME" to pooled(180))),
            "kaling" to
                mapOf("vestige-of-erion" to mapOf("HARD" to pooled(60), "EXTREME" to pooled(480))),
            "first-adversary" to
                mapOf("vestige-of-erion" to mapOf("HARD" to pooled(30), "EXTREME" to pooled(240))),
            "malefic-star" to mapOf("vestige-of-erion" to mapOf("HARD" to pooled(90))),
            "baldrix" to mapOf("vestige-of-erion" to mapOf("HARD" to pooled(120))),
            "jupiter" to
                mapOf("vestige-of-erion" to mapOf("NORMAL" to pooled(45), "HARD" to pooled(360))),
        )

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

    @Test
    fun `every verified amount is seeded, and nothing else is`() {
        val seeded =
            transaction {
                BossDropAmount
                    .innerJoin(BossCatalog)
                    .innerJoin(DropCatalog)
                    .selectAll()
                    .map {
                        Row(
                            boss = it[BossCatalog.bossKey],
                            drop = it[DropCatalog.dropKey],
                            difficulty = it[BossDropAmount.difficulty],
                            world = it[BossDropAmount.world],
                            pieces = it[BossDropAmount.pieces],
                        )
                    }
            }
        val actual =
            seeded
                .groupBy { it.boss }
                .mapValues { (_, ofBoss) ->
                    ofBoss.groupBy { it.drop }.mapValues { (_, ofDrop) ->
                        ofDrop.groupBy { it.difficulty }.mapValues { (_, ofMode) ->
                            ofMode.associate { it.world to it.pieces }
                        }
                    }
                }
        assertEquals(expected, actual, "the seeded amounts and catalog/drops.yaml disagree")
    }

    @Test
    fun `the drop table carries them per world, which is what fills the count`() {
        val kalos = transaction { dropTables()["kalos-the-guardian"] }.orEmpty()
        val vestige = kalos.single { it.dropKey == "vestige-of-erion" }
        assertEquals(mapOf("EXTREME" to 180), vestige.pieces["INTERACTIVE"])
        // Nothing for Heroic, because 180 is the size of a PILE and Reboot instances its pieces.
        // Seeded to both worlds, this figure had a Heroic party dividing coupons all six already
        // held. Absent fills nothing, which is the honest answer until somebody counts the real one.
        assertNull(vestige.pieces["HEROIC"])

        // A difficulty that drops none is ABSENT rather than zero, so the box fills nothing instead
        // of claiming the boss drops none at Chaos.
        assertNull(vestige.pieces["INTERACTIVE"]?.get("CHAOS"))

        // And a drop with no amounts at all is untouched by the join, rather than losing its row.
        assertEquals(emptyMap(), kalos.single { it.dropKey == "grindstone-of-life" }.pieces)
    }

    @Test
    fun `every drop with a Heroic count says it is instanced there`() {
        // Reboot hands each member their own pieces, so a Heroic figure is a count PER PERSON. A
        // drop carrying one without saying `per_member` is claiming Reboot pools it, and the Drop
        // Log divides whatever it finds: that is how a Heroic Kalos night was told its share of 180
        // coupons the party never held. build.py refuses the pair now; this is the seeded proof, so
        // a hand-edited R__ file cannot reintroduce it either.
        val offenders =
            transaction {
                dropTables().flatMap { (boss, drops) ->
                    drops
                        .filter { it.pieces["HEROIC"].orEmpty().isNotEmpty() }
                        .filter { it.perMember != "HEROIC" && it.perMember != "ALWAYS" }
                        .map { "$boss/${it.dropKey}" }
                }
            }

        assertEquals(emptyList(), offenders.sorted())
    }

    @Test
    fun `the vestige coupon is instanced in Heroic`() {
        // The control below is a drop that is pooled in BOTH worlds, so this cannot pass by every
        // drop having become per-member.
        val limbo = transaction { dropTables()["limbo"] }.orEmpty()

        assertEquals("HEROIC", limbo.single { it.dropKey == "vestige-of-erion" }.perMember)
        assertNull(limbo.single { it.dropKey == "grindstone-of-life" }.perMember)
    }

    private data class Row(
        val boss: String,
        val drop: String,
        val difficulty: String,
        val world: String,
        val pieces: Int,
    )

    private companion object {
        /**
         * The size of a POOL, which only Interactive has.
         *
         * Reboot instances every piece it drops, so there is no pile there for a pooled figure to
         * be the size of. These used to be written to both worlds, and the Drop Log divided the
         * Heroic copy: a Heroic Kalos night was told its share of 180 coupons the party never held
         * as 180. However many Reboot hands each member, it is not this number, so nothing is
         * seeded for it and the count is left for whoever logs the drop.
         */
        fun pooled(pieces: Int) = mapOf("INTERACTIVE" to pieces)
    }
}
