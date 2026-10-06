package com.sharpeyes.backend

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossDrop
import com.sharpeyes.backend.db.DropCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Which bosses drop each grindstone.
 *
 * Pinned because the failure it guards is silent and was live: Kaling carried only the Grindstone
 * of Faith, so a Kaling party had no way to enter the Grindstone of Life it had just looted. A
 * drop missing from a table is not a crash and not a wrong figure, it is a row nobody can log, and
 * the only place it shows up is somebody giving up on the picker.
 *
 * Kept as two whole sets rather than a "contains" check per boss. A boss that loses a grindstone
 * has to fail here too, which a contains-check would let through.
 */
class GrindstoneDropSeedTest {
    // Every boss here is from the patch notes except first-adversary and jupiter, which are
    // reported from runs. The stronger of the two sources, so this set has no row to re-check.
    private val life =
        setOf(
            "kalos-the-guardian",
            "kaling",
            "limbo",
            "baldrix",
            "malefic-star",
            "first-adversary",
            "jupiter",
        )
    private val faith = setOf("kaling", "limbo", "baldrix", "malefic-star", "jupiter")

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

    private fun bossesDropping(dropKey: String): Set<String> =
        transaction {
            BossDrop
                .innerJoin(BossCatalog)
                .innerJoin(DropCatalog)
                .selectAll()
                .filter { it[DropCatalog.dropKey] == dropKey }
                .map { it[BossCatalog.bossKey] }
                .toSet()
        }

    @Test
    fun `every boss that drops a Grindstone of Life offers it`() {
        assertEquals(life, bossesDropping("grindstone-of-life"))
    }

    @Test
    fun `every boss that drops a Grindstone of Faith offers it`() {
        assertEquals(faith, bossesDropping("grindstone-of-faith"))
    }
}
