package com.sharpeyes.backend.plugins

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Nothing serving a request may open a blocking transaction on the event loop.
 *
 * Netty gives this process one event loop thread per core and the prod box has two, so a `Routes`
 * file calling Exposed's blocking `transaction` directly parks one of the two threads that serve
 * every request. A page asking for sixteen things at once then queues behind itself: measured 57ms
 * median across three concurrent calls against 876ms across sixteen, same endpoints and data.
 * `dbQuery` (Database.kt) is the same work on Dispatchers.IO.
 *
 * A shape guard rather than a per-route test, like the frontend's auth-gate.test.ts: the mistake is
 * per-file, there are forty of them, and it reads as working either way. Only the wall clock under
 * load tells them apart, which is not something a unit test would catch.
 */
class EventLoopBlockingTest {
    // Off the request path by construction, each for a reason worth stating rather than a blanket
    // opt-out. Anything added here has to earn it.
    private val allowed =
        mapOf(
            // dbQuery is defined here.
            "Database.kt" to "defines dbQuery",
            // Runs the probe on a daemon thread it can abandon on timeout, so it is already off the
            // loop by a different route. See dbReachable.
            "HealthRoutes.kt" to "probes on its own abandonable thread",
            // A background loop, launched on Dispatchers.IO rather than the Application scope.
            "SpriteRefreshJob.kt" to "launched on Dispatchers.IO",
        )

    private fun kotlinSources(): List<File> =
        File("src/main/kotlin")
            .walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .toList()

    // `transaction {` and `transaction(statement = block)` both open one. Comments are stripped
    // first: several of these files carry a note saying their helpers must be called from inside a
    // transaction, and matching that prose would fail the guard on the documentation of the rule.
    private fun opensTransaction(file: File): Boolean {
        val code =
            file
                .readText()
                .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
                .replace(Regex("""//.*"""), "")
        return Regex("""\btransaction\s*[({]""").containsMatchIn(code)
    }

    @Test
    fun `no request path opens a blocking transaction`() {
        val offenders =
            kotlinSources()
                .filter { it.name !in allowed }
                .filter { opensTransaction(it) }
                .map { it.path }

        assertTrue(
            offenders.isEmpty(),
            "These open Exposed's blocking transaction outside Dispatchers.IO. Use dbQuery, or add " +
                "the file to `allowed` with the reason it is off the request path:\n" +
                offenders.joinToString("\n"),
        )
    }

    // A guard whose allowlist has gone stale stops guarding and nobody notices, so the entries are
    // checked too: a name here that no longer opens a transaction is one to delete.
    @Test
    fun `every allowed file still opens one`() {
        val sources = kotlinSources().associateBy { it.name }
        val stale =
            allowed.keys.filter { name ->
                val file = sources[name] ?: return@filter true
                !opensTransaction(file)
            }

        assertTrue(stale.isEmpty(), "No longer opens a blocking transaction, so drop it from `allowed`: $stale")
    }
}
