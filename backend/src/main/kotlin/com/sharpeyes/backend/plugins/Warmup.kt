package com.sharpeyes.backend.plugins

import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.pages.dropLogPageFor
import io.ktor.server.application.Application
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.slf4j.LoggerFactory
import kotlin.time.measureTime

private val log = LoggerFactory.getLogger("Warmup")

private const val WARMUP_PASSES = 3

/**
 * Run the heaviest reads once, before this replica takes traffic.
 *
 * The first request after a deploy has been slow every time: measured against the dev copy of real
 * data, the first `partiesFor` + `allLootFor` took 1071ms and the second 154ms. In prod that showed
 * as `/api/pages/drop-log` at 1097-1120ms on the first load after each of five deploys against
 * 261-399ms warm, and a `data-ready` of 1321-1450ms against ~530ms. It is JIT and lazy
 * initialisation, not the queries: individual queries on that box measure 0.6-2ms.
 *
 * Somebody pays that once per deploy. This makes it the deploy rather than whoever opens the site
 * next. Measured with the same harness: warming first put the first real read at 200ms instead of
 * 1071ms.
 *
 * Called synchronously from `module()`, which is the point: deploy.sh waits on /health before it
 * lets a restarted replica take traffic, and /health cannot answer until this returns. Roughly a
 * second of boot, spent where nobody is waiting on it.
 */
fun Application.warmReadPaths() {
    val elapsed =
        measureTime {
            // Any existing account will do. The warmup is for the code path, not the rows: the user
            // measured above had two parties and one loot row and still bought the full 1071 -> 200ms.
            // Reads only, and the results are discarded.
            val someone =
                runCatching {
                    transaction {
                        Users
                            .selectAll()
                            .limit(1)
                            .firstOrNull()
                            ?.get(Users.id)
                    }
                }.getOrNull()

            if (someone == null) {
                log.info("Warmup skipped: no accounts yet")
                return
            }

            // Read AND serialise, because priming the reads alone was measurably not enough. The
            // first version of this warmed only the queries and prod's first request went from
            // 1097-1120ms to 931ms, against the 1071 -> 200ms the queries showed in isolation. The
            // gap is the rest of answering: `Json.encodeToString` of this payload measured 45ms on
            // its first call against 3-5ms after, on a 190kb response.
            //
            // More than one pass: first-real-read after warming was 324ms after a single pass and
            // 200ms after five, against 1071ms cold. Three is where it stops paying, and the cost
            // lands on a boot nobody is waiting on.
            //
            // Never fatal. A replica that could not warm is slow once, but a replica that refused to
            // boot over it would be down, and deploy.sh reads a failed health check as a bad deploy.
            runCatching {
                repeat(WARMUP_PASSES) {
                    val page = transaction { dropLogPageFor(someone) }
                    // Discarded. Encoding it is the point, not the string.
                    Json.encodeToString(page)
                }
            }.onFailure { log.warn("Warmup failed, first request will pay for it", it) }
        }
    log.info("Warmup: read paths primed in ${elapsed.inWholeMilliseconds}ms")
}
