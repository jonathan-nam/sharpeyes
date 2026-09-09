package com.sharpeyes.backend.pages

import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.bosses.clearsView
import com.sharpeyes.backend.bosses.dropTables
import com.sharpeyes.backend.characters.charactersInActiveWorld
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.partiesFor
import com.sharpeyes.backend.parties.partiesSeatedIn
import com.sharpeyes.backend.parties.peopleFor
import com.sharpeyes.backend.parties.settlementsFor
import com.sharpeyes.backend.plugins.addSpan
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlin.time.Clock
import kotlin.time.Duration
import kotlin.time.measureTimedValue

/**
 * Party View's own reads, in two requests instead of nine.
 *
 * The current week only. Stepping to a past week still uses the individual endpoints, because that
 * is a click rather than a page load and it needs two reads rather than nine. So neither of these
 * takes a `week`: an initial load is always the current one.
 */
internal suspend fun RoutingContext.partiesPage() {
    val (userId, email) = call.principalIdAndEmail()

    // Local, not file scope: two requests in flight would otherwise share one list and report each
    // other's timings.
    val stages = mutableListOf<Pair<String, Duration>>()
    val page =
        dbQuery {
            ensureUser(userId, email)
            // Solo and retired included, as the page asks for them: both hold pools a ledger needs.
            // See the note on PARTY_LIST_KEY in app/bosses/parties/page.tsx.
            val parties =
                measureTimedValue {
                    partiesFor(userId, week = null, includeSolo = true, includeRetired = true)
                }
            stages += "parties" to parties.duration
            PartiesPageResponse(
                parties = parties.value,
                bosses = bossCatalog(),
                characters = charactersInActiveWorld(userId),
            )
        }
    for ((name, elapsed) in stages) call.addSpan(name, elapsed)

    call.respond(page)
}

internal suspend fun RoutingContext.partiesExtras() {
    val (userId, email) = call.principalIdAndEmail()
    val now = Clock.System.now()

    val stages = mutableListOf<Pair<String, Duration>>()
    val extras =
        dbQuery {
            ensureUser(userId, email)
            val pools = measureTimedValue { allLootFor(userId) }
            stages += "pools" to pools.duration

            val rest =
                measureTimedValue {
                    PartiesExtrasResponse(
                        clears = clearsView(userId, week = null, now = now),
                        drops = dropTables(),
                        people = peopleFor(userId),
                        pools = pools.value,
                        settlements = settlementsFor(userId),
                        seated = partiesSeatedIn(userId),
                    )
                }
            stages += "rest" to rest.duration
            rest.value
        }
    for ((name, elapsed) in stages) call.addSpan(name, elapsed)

    call.respond(extras)
}
