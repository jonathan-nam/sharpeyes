package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.plugins.Refusal
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Two keyboards on one pool is how one night gets logged twice, a count that looks right and is
// not. Not a unique index: two copies of one drop in one period are real, so a second is asked
// for rather than refused outright. Inside a transaction, like the rest.

/** A drop already in [partyId]'s pool for the same period of its boss, or null when there is none. */
internal fun duplicateRefusal(
    partyId: Uuid,
    item: LootedDrop,
    bossCatalogId: Uuid?,
    droppedOn: LocalDate,
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
    return if (logged) {
        Refusal(
            "This drop is already logged for that $span. Add it again only if a second one fell.",
        )
    } else {
        null
    }
}

/** Refused as a probable second logging of one drop: a 409, so the form can offer to add it again. */
internal data class Duplicate(
    val refusal: Refusal,
)

/** Logs a validated drop into [partyId]'s pool, unless it looks like one already there. */
internal fun addPoolDrop(
    partyId: Uuid,
    userId: String,
    item: LootedDrop,
    bossId: Uuid?,
    droppedOn: LocalDate,
    request: AddLootRequest,
): Any {
    val duplicate = if (request.again) null else duplicateRefusal(partyId, item, bossId, droppedOn)
    if (duplicate != null) return Duplicate(duplicate)
    val lootId = addLoot(partyId, item, bossId, droppedOn, Clock.System.now(), LootSource(recordedBy = userId))
    addedBundles(lootId, partyId, request.bundles)
    poolChanged(partyId)
    return findLoot(lootId, partyId, userId)!!
}
