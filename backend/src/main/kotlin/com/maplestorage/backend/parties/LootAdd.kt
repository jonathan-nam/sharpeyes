package com.maplestorage.backend.parties

import kotlinx.datetime.LocalDate
import kotlin.time.Clock
import kotlin.uuid.Uuid

// What POST /api/parties/{id}/loot does once the party is known to be the caller's. In its own file
// for the reason LootBundles.kt is, LootRoutes.kt being at detekt's function ceiling.

/**
 * The refusals that need the party proved yours first, then the drop and everything sent with it.
 *
 * Split out of addLootRoute rather than listed as more `when` branches, which is what keeps that
 * function under detekt's complexity ceiling. The order is the point: nothing is written until every
 * refusal has had its say, and the arrangement is the one exception, refused after the insert and
 * throwing so it takes the insert with it. See addedBundles.
 */
internal fun addedDrop(
    partyId: Uuid,
    request: AddLootRequest,
    drop: LootedDrop,
    bossId: Uuid?,
    droppedOn: LocalDate,
): Any =
    quantityRefusal(request.quantity)
        ?: looterRefusal(partyId, droppedOn, request.looterMemberId)
        ?: run {
            val lootId = addLoot(partyId, drop, bossId, droppedOn, Clock.System.now())
            recordLooter(lootId, request.looterMemberId)
            addedBundles(lootId, partyId, request.bundles)
            findLoot(lootId, partyId)!!
        }
