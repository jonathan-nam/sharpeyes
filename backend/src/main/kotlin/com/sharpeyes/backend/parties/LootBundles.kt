package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyLootBundle
import com.sharpeyes.backend.db.VestigeSettlementLoot
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Who picked up which stacks of a drop: the read, and PUT /{lootId}/bundles, registered by
// LootRoutes.kt. In its own file only because both of those files are at detekt's function ceiling.
//
// The one fact about a drop that cannot be worked out from anything else. Everyone takes
// floor(stacks / seats) and the remainder goes to somebody, and which somebody happened in the map.
// See V41__loot_bundles.sql.

/** What a settled night answers with, said once so the route stays inside its line length. */
private const val SETTLED_STANDS = "this drop is settled, so who picked up which stack stands"

/** Which seat picked up how many stacks, per drop. An absent drop is one nobody has answered for. */
internal fun bundlesFor(lootIds: List<Uuid>): Map<Uuid, List<LootBundleResponse>> =
    PartyLootBundle
        .selectAll()
        .where { PartyLootBundle.lootId inList lootIds }
        .groupBy({ it[PartyLootBundle.lootId] }) {
            LootBundleResponse(
                memberId = it[PartyLootBundle.memberId].toString(),
                bundles = it[PartyLootBundle.bundles],
            )
        }

/**
 * A refusal raised once the drop is already inserted. Thrown so the insert rolls back with it.
 *
 * Returning the string instead would leave the drop stored and the caller told the add failed, which
 * is the landed-but-reported-failed shape that logged one Hard Kaling night twice. One act was
 * asked for, so one answer is owed: either the night is recorded whole, or not at all.
 */
internal class BundlesRefused(
    val reason: String,
) : RuntimeException(reason)

/**
 * Records the arrangement sent with a drop that has just been added, or refuses the whole add.
 *
 * Validated against the row as STORED rather than against the request: `ranThatWeek` and the stack
 * count are derived server side, and checking the caller's idea of them would be checking the answer
 * against itself.
 *
 * Absent is the ordinary case and writes nothing, leaving the drop unanswered exactly as a drop
 * added without an arrangement is.
 */
internal fun addedBundles(
    lootId: Uuid,
    partyId: Uuid,
    bundles: Map<String, Int>?,
) {
    if (bundles.isNullOrEmpty()) return
    if (bundles.keys.any { Uuid.parseOrNull(it) == null }) throw BundlesRefused("malformed memberId")
    val loot = findLoot(lootId, partyId)!!
    bundlesRefusal(bundles, loot.ranThatWeek, loot.bundles)?.let { throw BundlesRefused(it) }
    setLootBundles(lootId, bundles.mapKeys { Uuid.parse(it.key) })
}

/**
 * The books have closed over this drop, so who held what is history.
 *
 * A settlement is a claim about the stacks: it was made against these figures and somebody has been
 * paid against them. Rewriting the arrangement afterwards moves a number that has already been
 * acted on, silently, which is the failure this project exists to prevent. The same protection
 * LootFromClear's spokenFor gives the other way a drop can be rewritten from under a closure.
 *
 * Refused HERE and not only hidden on the screens. A button that is not drawn is not a rule.
 */
internal fun settledAlready(lootId: Uuid): Boolean =
    !VestigeSettlementLoot
        .selectAll()
        .where { VestigeSettlementLoot.lootId eq lootId }
        .empty()

/**
 * Records who picked up which stacks of a drop.
 *
 * No default is written here or anywhere else. The best guess is whoever is furthest behind, which
 * reads off a running balance that moves whenever an earlier week is edited, so a stored guess would
 * rewrite who owed what on nights already settled. An unanswered drop stays unanswered.
 */
internal suspend fun RoutingContext.setBundlesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return
    val request = call.receive<LootBundlesRequest>()

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val loot = findLoot(lootId, partyId)
            when {
                !ownsParty(partyId, userId) -> null
                loot == null -> null
                request.bundles.keys.any { Uuid.parseOrNull(it) == null } -> "malformed memberId"
                settledAlready(lootId) -> SETTLED_STANDS
                bundlesRefusal(request.bundles, loot.ranThatWeek, loot.bundles) != null ->
                    bundlesRefusal(request.bundles, loot.ranThatWeek, loot.bundles)
                else -> {
                    setLootBundles(lootId, request.bundles.mapKeys { Uuid.parse(it.key) })
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}
