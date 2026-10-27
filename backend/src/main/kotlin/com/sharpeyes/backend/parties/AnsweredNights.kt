package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.LootResponse
import com.sharpeyes.api.loot.PartyLootPoolResponse
import com.sharpeyes.backend.pages.dropLogPageFor
import com.sharpeyes.backend.pages.moneyPageOf
import com.sharpeyes.money.settlement.VESTIGE
import com.sharpeyes.money.settlement.answeredNights

// Which coupon nights are locked, off the owner's whole book. See answeredNights in shared/money.
// Inside a transaction, like the rest.

/** [owner]'s locked coupon nights. A whole Drop Log read, so only asked where a pool holds one. */
internal fun answeredNightsFor(owner: String): Set<String> =
    answeredNights(moneyPageOf(dropLogPageFor(owner, answered = false)))

private fun LootResponse.openCouponNight() = dropKey == VESTIGE && soldAt == null && !settled

internal fun List<LootResponse>.withAnsweredNights(owner: String): List<LootResponse> =
    if (none { it.openCouponNight() }) this else lockedBy(answeredNightsFor(owner))

@JvmName("poolsWithAnsweredNights")
internal fun List<PartyLootPoolResponse>.withAnsweredNights(owner: String): List<PartyLootPoolResponse> =
    if (none { pool -> pool.loot.any { it.openCouponNight() } }) this else lockedBy(answeredNightsFor(owner))

internal fun List<LootResponse>.lockedBy(nights: Set<String>): List<LootResponse> =
    map { if (it.id in nights) it.copy(settled = true) else it }

@JvmName("poolsLockedBy")
internal fun List<PartyLootPoolResponse>.lockedBy(nights: Set<String>): List<PartyLootPoolResponse> =
    map { it.copy(loot = it.loot.lockedBy(nights)) }
