package com.sharpeyes.backend.bosses

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The catalog tables are written by migrations and by nothing else.
 *
 * bossCatalog() and dropTables() hold their answer for the life of the process, and that is only
 * correct while this holds: `R__boss_catalog.sql` and `R__drop_catalog.sql` are repeatable
 * migrations, so a catalog change arrives as a deploy and Flyway applies it during boot. Add a
 * runtime write to one of these tables and the cache serves the old rows until the next restart,
 * silently, which is the failure this repo exists to prevent rather than a slow page.
 *
 * A shape guard, like EventLoopBlockingTest: the mistake is one line in a file nobody is looking at,
 * and it reads as perfectly reasonable.
 */
class CatalogIsReadOnlyTest {
    // The tables the two cached reads are built from.
    private val catalogTables = listOf("BossCatalog", "BossDrop", "BossDropAmount")

    private val writes = listOf("insert", "update", "delete", "upsert", "batchInsert", "replace")

    /** `BossCatalog.insert {`, and the same reached through a chained call on the object. */
    private val writePatterns =
        catalogTables.flatMap { table ->
            writes.map { write -> "$table.$write" to Regex("""\b$table\s*\.\s*$write\b""") }
        }

    private fun codeOf(file: File): String =
        file
            .readText()
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .replace(Regex("""//.*"""), "")

    @Test
    fun `nothing outside a migration writes the catalog`() {
        val offenders =
            File("src/main/kotlin")
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" }
                .flatMap { file ->
                    val code = codeOf(file)
                    writePatterns
                        .filter { (_, pattern) -> pattern.containsMatchIn(code) }
                        .map { (name, _) -> "${file.path}: $name" }
                }.toList()

        assertTrue(
            offenders.isEmpty(),
            "These write a catalog table at runtime, which makes the process-lifetime cache in " +
                "bossCatalog()/dropTables() serve stale rows until a restart. Either drop the cache " +
                "or keep the write in a migration:\n" + offenders.joinToString("\n"),
        )
    }

    // A guard naming tables that no longer exist stops guarding without saying so.
    @Test
    fun `the tables it names are still real`() {
        val tables =
            File("src/main/kotlin/com/sharpeyes/backend/db")
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" }
                .joinToString("\n") { it.readText() }

        val missing = catalogTables.filterNot { Regex("""object $it\s*:""").containsMatchIn(tables) }

        assertTrue(missing.isEmpty(), "No longer a table, so this guard is watching nothing: $missing")
    }
}
