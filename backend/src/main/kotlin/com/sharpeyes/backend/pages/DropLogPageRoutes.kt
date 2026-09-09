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
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get

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
}

private suspend fun RoutingContext.dropLogPage() {
    val (userId, email) = call.principalIdAndEmail()
    val page =
        dbQuery {
            ensureUser(userId, email)
            dropLogPageFor(userId)
        }
    call.respond(page)
}

/**
 * The reads themselves, so the boot warmup can prime the same ones the route runs.
 *
 * Shared rather than copied: a warmup that primed a different set of queries would look like it was
 * working and would not be. Must be called from inside a `transaction { }` block.
 */
internal fun dropLogPageFor(userId: String): DropLogPageResponse =
    DropLogPageResponse(
        // Solo and retired configs included, matching the page's own query string. Both matter to a
        // ledger: see the note on PARTIES_KEY in app/bosses/drops/page.tsx. A null week means the
        // current one, as partiesFor's own default does.
        parties = partiesFor(userId, week = null, includeSolo = true, includeRetired = true),
        pools = allLootFor(userId),
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
