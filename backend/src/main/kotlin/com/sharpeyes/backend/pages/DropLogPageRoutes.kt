package com.sharpeyes.backend.pages

import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.bosses.dropTables
import com.sharpeyes.backend.characters.charactersInActiveWorld
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.debtsFor
import com.sharpeyes.backend.parties.disposalsFor
import com.sharpeyes.backend.parties.partiesFor
import com.sharpeyes.backend.parties.paymentsFor
import com.sharpeyes.backend.parties.peopleFor
import com.sharpeyes.backend.parties.settlementsFor
import com.sharpeyes.backend.parties.tranchesFor
import com.sharpeyes.backend.plugins.addSpan
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import kotlin.time.Duration
import kotlin.time.measureTimedValue

/**
 * A whole screen's reads, in one request each.
 *
 * The individual endpoints stay and other pages still read them. A composite is a page's
 * convenience, not a replacement for the resources underneath it, and only a page heavy enough to
 * be paying for the per-request overhead should get one. See DropLogPageResponse.kt for the measurement
 * that justified this one.
 */
fun Route.pageRoutes() {
    get("/drop-log") { dropLogPage() }

    // Party View takes two rather than one, and PartiesPageResponse.kt says why: six of its nine
    // reads are ones the page is built to survive losing.
    get("/parties") { partiesPage() }
    get("/parties/extras") { partiesExtras() }
}

private suspend fun RoutingContext.dropLogPage() {
    val (userId, email) = call.principalIdAndEmail()

    // Collected inside the transaction and attached after, because a span cannot be taken in there:
    // see addSpan. Two guesses about where this endpoint's cold time went were both wrong, so it
    // reports its own breakdown now rather than being guessed at a third time.
    val stages = mutableListOf<Pair<String, Duration>>()
    val page =
        dbQuery {
            ensureUser(userId, email)
            dropLogPageFor(userId) { name, elapsed -> stages += name to elapsed }
        }
    for ((name, elapsed) in stages) call.addSpan(name, elapsed)

    call.respond(page)
}

/**
 * The reads themselves, so the boot warmup can prime the same ones the route runs.
 *
 * Shared rather than copied: a warmup that primed a different set of queries would look like it was
 * working and would not be. Must be called from inside a `transaction { }` block.
 *
 * [onStage] receives each read's own time. The route turns those into Server-Timing entries; the
 * warmup ignores them, since nobody is reading a header at boot. Only the two that measured worth
 * splitting are named: on the dev copy of real data these were ~19ms and ~20ms of a ~46ms whole,
 * and everything else came in under a millisecond each.
 */
internal fun dropLogPageFor(
    userId: String,
    onStage: (String, Duration) -> Unit = { _, _ -> },
): DropLogPageResponse {
    // Solo and retired configs included, matching the page's own query string. Both matter to a
    // ledger: see the note on PARTIES_KEY in app/bosses/drops/page.tsx. A null week means the
    // current one, as partiesFor's own default does.
    val parties = measureTimedValue { partiesFor(userId, week = null, includeSolo = true, includeRetired = true) }
    onStage("parties", parties.duration)

    val pools = measureTimedValue { allLootFor(userId) }
    onStage("pools", pools.duration)

    val rest =
        measureTimedValue {
            DropLogPageResponse(
                parties = parties.value,
                pools = pools.value,
                tranches = tranchesFor(userId),
                payments = paymentsFor(userId),
                settlements = settlementsFor(userId),
                debts = debtsFor(userId),
                disposals = disposalsFor(userId),
                bosses = bossCatalog(),
                drops = dropTables(),
                characters = charactersInActiveWorld(userId),
                people = peopleFor(userId),
            )
        }
    onStage("rest", rest.duration)
    return rest.value
}
