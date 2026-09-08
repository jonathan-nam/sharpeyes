package com.sharpeyes.backend.plugins

import com.sharpeyes.backend.config.Env
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.JdbcTransaction
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Duration.Companion.seconds

// Postgres is a container sharing a 2 GB box with nginx, the auth service and two backend
// replicas, and each replica holds its own pool. Keep it small rather than taking Hikari's
// default of 10 twice over.
private const val MAX_POOL_SIZE = 5

/**
 * How long a request waits for a connection before giving up.
 *
 * Set because dbQuery makes this the queue: every concurrent read now waits here rather than on an
 * event loop thread, which is the point, but Hikari's default wait is 30 SECONDS. A page's queries
 * take tens of milliseconds, so anything approaching this is a pool that is not coming back, and a
 * fast 500 that gets logged with a reason (see Timing.kt) beats a request that hangs half a minute
 * and tells nobody. HealthRoutes.kt bounds its own probe for the same reason.
 */
private val CONNECTION_TIMEOUT = 10.seconds

fun Application.configureDatabase() {
    val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"

    // Runs on every boot. Safe no-op when there's nothing new to apply.
    Flyway
        .configure()
        .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
        .load()
        .migrate()

    val hikariConfig =
        HikariConfig().apply {
            this.jdbcUrl = jdbcUrl
            username = Env.dbUsername
            password = Env.dbPassword
            driverClassName = "org.postgresql.Driver"
            maximumPoolSize = MAX_POOL_SIZE
            connectionTimeout = CONNECTION_TIMEOUT.inWholeMilliseconds
            poolName = "sharpeyes-hikari"
        }
    val dataSource = HikariDataSource(hikariConfig)
    monitor.subscribe(ApplicationStopped) { dataSource.close() }

    Database.connect(datasource = dataSource)
}

/**
 * A request's database work, off the event loop.
 *
 * Netty gives this process one event loop thread per core and the box has two, so every request in
 * a prod log sample came off one of exactly two threads. Exposed's `transaction` is blocking JDBC,
 * so calling it straight from a handler parks one of those two for the whole query, and a page that
 * asks for sixteen things at once queues behind itself: measured 57ms median across three
 * concurrent calls against 876ms across sixteen, same endpoints and same data minutes apart.
 *
 * Dispatchers.IO instead, where blocking is what the threads are for. MAX_POOL_SIZE above becomes
 * the limit on concurrent queries, which is the limit we actually chose.
 *
 * Use this from anything serving a request. Plain `transaction` is still right for work already off
 * the event loop: startup, and a nested call inside one of these (Exposed keys the transaction to
 * the thread, and withContext confines the block to one, so nesting still joins the outer one).
 */
suspend fun <T> dbQuery(block: JdbcTransaction.() -> T): T =
    withContext(Dispatchers.IO) {
        transaction(statement = block)
    }
