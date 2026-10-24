package com.sharpeyes.backend.pages

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Users
import com.sharpeyes.money.DropLogFigures
import com.sharpeyes.money.moneyJson
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.io.File
import kotlin.test.Test

/**
 * Writes every account's Drop Log page, shared books and figures, exactly as the routes serve them, for
 * an audit of the money port against real data (docs/backend-arithmetic-plan.md, Phase 4).
 *
 * Does nothing unless MONEY_PAGES_OUT names a directory. Point DB_NAME at a throwaway restore, never
 * the dev database: this migrates it. The pages hold real names and amounts and never belong in the
 * repo.
 */
class PageDumpTest {
    @Test
    fun `writes each account's pages for an audit`() {
        val out = System.getenv("MONEY_PAGES_OUT")?.let(::File) ?: return
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
        out.mkdirs()
        val json = Json { encodeDefaults = true }
        transaction {
            for (user in Users.selectAll().map { it[Users.id] }) {
                File(out, "$user.page.json").writeText(json.encodeToString(dropLogPageFor(user)))
                File(out, "$user.books.json").writeText(json.encodeToString(sharedBooksFor(user)))
                File(out, "$user.figures.json")
                    .writeText(moneyJson.encodeToString(DropLogFigures.serializer(), dropLogFiguresFor(user)))
            }
        }
    }
}
