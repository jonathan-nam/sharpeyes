package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.LootResponse
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.DropCatalog
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootBundle
import com.sharpeyes.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

// Who picks up which stacks of a coupon row AutoVestiges.kt filed, and the lookups both files share.
// Inside a transaction, like the rest.

private const val VESTIGE_KEY = "vestige-of-erion"

internal fun vestigeId(): Uuid? =
    DropCatalog
        .selectAll()
        .where { DropCatalog.dropKey eq VESTIGE_KEY }
        .firstOrNull()
        ?.get(DropCatalog.id)

/** The world a config's own character is in, which every catalog count is keyed on. */
internal fun worldOf(config: ResultRow): String? =
    Characters
        .selectAll()
        .where { Characters.id eq config[Party.characterId] }
        .firstOrNull()
        ?.get(Characters.worldType)

/**
 * The stacks the way the last night handed them out, or by the Entitled ratio when there is no last
 * night the roster can repeat. Null when neither adds up, which bundlesRefusal decides.
 */
internal fun plannedSplit(
    partyId: Uuid,
    loot: LootResponse,
    vestige: Uuid,
    period: LocalDate,
): Map<Uuid, Int>? {
    val stacks = loot.bundles ?: return null
    val fits = { split: Map<Uuid, Int> ->
        split.isNotEmpty() && bundlesRefusal(split.mapKeys { it.key.toString() }, loot.ranThatWeek, stacks) == null
    }
    return lastSplit(partyId, vestige, period)?.takeIf(fits)
        ?: byShares(loot.ranThatWeek.map(Uuid::parse), stacks).takeIf(fits)
}

/** Writes [plannedSplit] as the app's, or leaves the row unanswered. */
internal fun autoSplit(
    partyId: Uuid,
    lootId: Uuid,
    vestige: Uuid,
    period: LocalDate,
) {
    val split = findLoot(lootId, partyId)?.let { plannedSplit(partyId, it, vestige, period) } ?: return
    setLootBundles(lootId, split)
    PartyLoot.update({ PartyLoot.id eq lootId }) { it[autoSplit] = true }
}

/** The pickup on the latest earlier coupon night anybody answered, or null when there is none. */
private fun lastSplit(
    partyId: Uuid,
    vestige: Uuid,
    before: LocalDate,
): Map<Uuid, Int>? {
    val earlier =
        PartyLoot
            .selectAll()
            .where {
                (PartyLoot.partyId eq partyId) and
                    (PartyLoot.dropCatalogId eq vestige) and
                    (PartyLoot.droppedOn less before)
            }.orderBy(PartyLoot.droppedOn to SortOrder.DESC, PartyLoot.createdAt to SortOrder.DESC)
            .map { it[PartyLoot.id] }
    val answered =
        PartyLootBundle
            .selectAll()
            .where { PartyLootBundle.lootId inList earlier }
            .groupBy({ it[PartyLootBundle.lootId] }) { it[PartyLootBundle.memberId] to it[PartyLootBundle.bundles] }
    return earlier.firstNotNullOfOrNull { answered[it]?.toMap() }
}

/**
 * [stacks] divided by each seat's Entitled shares. Even when the shares are. The server's copy of
 * suggestArrangement without the running balance, which is the frontend's and moves whenever an
 * earlier week is edited.
 */
private fun byShares(
    seats: List<Uuid>,
    stacks: Int,
): Map<Uuid, Int> {
    val shares =
        PartyMember
            .selectAll()
            .where { PartyMember.id inList seats }
            .associate { it[PartyMember.id] to it[PartyMember.shares] }
    return divideStacks(seats.map { it to (shares[it] ?: 0) }, stacks)
}

/** Largest remainder first, ties to the earlier seat. Apart so it is testable without a database. */
internal fun divideStacks(
    weights: List<Pair<Uuid, Int>>,
    stacks: Int,
): Map<Uuid, Int> {
    val total = weights.sumOf { it.second }
    if (total <= 0 || stacks <= 0) return emptyMap()
    val floors = weights.associate { (id, w) -> id to (stacks * w) / total }.toMutableMap()
    var left = stacks - floors.values.sum()
    // Stable, so equal remainders keep seat order.
    val order = weights.sortedByDescending { (_, w) -> (stacks * w) % total }
    for ((id, _) in order) {
        if (left <= 0) break
        floors[id] = floors.getValue(id) + 1
        left -= 1
    }
    // A seat with no stacks is left out rather than given a zero, which bundlesRefusal refuses.
    return floors.filterValues { it > 0 }
}
