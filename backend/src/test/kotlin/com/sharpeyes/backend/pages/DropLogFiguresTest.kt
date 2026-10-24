package com.sharpeyes.backend.pages

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The served page reaches the money module intact. Its arithmetic is the money module's own tests. */
class DropLogFiguresTest {
    private val user = "user_test_drop_log_figures"

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
    fun `an account with nothing logged has no figures`() {
        val figures =
            transaction {
                ensureUser(user, "$user@example.com")
                dropLogFiguresFor(user)
            }
        assertTrue(figures.view.settlement.isEmpty())
        assertTrue(figures.log.entries.isEmpty())
        assertEquals(0.0, figures.view.totals.owed)
    }
}
