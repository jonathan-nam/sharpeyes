package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.AddLootRequest
import com.sharpeyes.api.system.Refusal
import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Two keyboards on one pool is how one night gets logged twice, a count that looks right and is
// not. Not a unique index: two copies of one drop in one period are real, so a second is asked
// for rather than refused outright. That is a TYPED drop only: a catalog drop falls once per clear,
// see onlyOnceRefusal. Inside a transaction, like the rest.

/** A drop already in [partyId]'s pool for the same period of its boss, or null when there is none. */
internal fun duplicateRefusal(
    partyId: Uuid,
    item: LootedDrop,
    bossCatalogId: Uuid?,
    droppedOn: LocalDate,
    onlyOnce: Boolean = false,
): Refusal? {
    val reset = (bossCatalogId ?: bossIdOfParty(partyId))?.let { bossResetOf(it) } ?: return null
    val period = periodOf(reset, droppedOn)
    val logged =
        PartyLoot
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            .any {
                val same =
                    if (item.dropCatalogId != null) {
                        it[PartyLoot.dropCatalogId] == item.dropCatalogId
                    } else {
                        it[PartyLoot.customName].equals(item.customName, ignoreCase = true)
                    }
                same && periodOf(reset, it[PartyLoot.droppedOn]) == period
            }
    val span =
        when (reset) {
            "DAILY" -> "day"
            "MONTHLY" -> "month"
            else -> "week"
        }
    return when {
        !logged -> null
        onlyOnce -> Refusal("This drop is already logged for that $span.")
        else -> Refusal("This drop is already logged for that $span. Add it again only if a second one fell.")
    }
}

/** Refused as a probable second logging of one drop: a 409, so the form can offer to add it again. */
internal data class Duplicate(
    val refusal: Refusal,
)

/**
 * Whether the catalog counts this drop for its boss (vestige coupons). A boss drops one batch per
 * clear, so a second row in one period is always the same night logged twice, never a second drop.
 */
private fun isCountedDrop(
    partyId: Uuid,
    item: LootedDrop,
    bossCatalogId: Uuid?,
): Boolean {
    val dropId = item.dropCatalogId
    val bossId = bossCatalogId ?: bossIdOfParty(partyId)
    return dropId != null &&
        bossId != null &&
        !BossDropAmount
            .selectAll()
            .where { (BossDropAmount.bossCatalogId eq bossId) and (BossDropAmount.dropCatalogId eq dropId) }
            .empty()
}

/**
 * Refuses a catalog drop already in [partyId]'s pool for its period, with no way to add it again
 * (a plain Refusal is a 400, not Duplicate's 409), and any but a counted one at more than 1. A boss
 * drops each item once per clear, vestiges as one batch. A typed drop could be anything, so it is
 * left to duplicateRefusal. Every path that adds to a pool calls this.
 */
internal fun onlyOnceRefusal(
    partyId: Uuid,
    item: LootedDrop,
    bossId: Uuid?,
    droppedOn: LocalDate,
): Refusal? {
    // Two members adding at once would both pass the check. Holding the party row makes the second
    // wait for the first to commit, and then see its row.
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .forUpdate()
        .firstOrNull()
    return when {
        item.dropCatalogId == null -> null
        item.quantity != 1 && !isCountedDrop(partyId, item, bossId) -> Refusal("This drop falls one at a time.")
        else -> duplicateRefusal(partyId, item, bossId, droppedOn, onlyOnce = true)
    }
}

/** Logs a validated drop into [partyId]'s pool, unless it looks like one already there. */
internal fun addPoolDrop(
    partyId: Uuid,
    userId: String,
    item: LootedDrop,
    bossId: Uuid?,
    droppedOn: LocalDate,
    request: AddLootRequest,
): Any {
    val refused =
        onlyOnceRefusal(partyId, item, bossId, droppedOn)
            ?: if (request.again || item.dropCatalogId != null) {
                null
            } else {
                duplicateRefusal(partyId, item, bossId, droppedOn)?.let(::Duplicate)
            }
    if (refused != null) return refused
    val lootId = addLoot(partyId, item, bossId, droppedOn, Clock.System.now(), LootSource(recordedBy = userId))
    addedBundles(lootId, partyId, request.bundles)
    poolChanged(partyId, lootId)
    return findLoot(lootId, partyId, userId)!!
}
