package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.greaterEq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A PARTY's guaranteed coupons, filed when its boss is cleared, on parties with it on (V102).
// LootFromClear.kt is the solo half and explains why parties were left out: a row nobody typed has
// stacks nobody agreed to. Here the app agrees to them too (AutoVestigeSplit.kt), and the row stays
// the app's until a person saves its split or sells it. Until then a clear, mode or roster change
// re-files it, so it never holds a count from a mode the party left. Inside a transaction.

/** One party's coupons in one period: what every step below reads. */
private class Week(
    val config: ResultRow,
    val vestige: Uuid,
    val period: LocalDate,
    val end: LocalDate,
) {
    val partyId: Uuid get() = config[Party.id]
}

private fun configOf(partyId: Uuid): ResultRow? = Party.selectAll().where { Party.id eq partyId }.firstOrNull()

/** Turns it on for a new party when its boss drops coupons at any mode in its world. */
internal fun defaultAutoVestiges(partyId: Uuid) {
    val config = configOf(partyId)
    val vestige = vestigeId()
    val world = config?.let(::worldOf)
    if (config == null || vestige == null || world == null) return
    val drops =
        !BossDropAmount
            .selectAll()
            .where {
                (BossDropAmount.bossCatalogId eq config[Party.bossCatalogId]) and
                    (BossDropAmount.world eq world) and
                    (BossDropAmount.dropCatalogId eq vestige)
            }.empty()
    if (drops) Party.update({ Party.id eq partyId }) { it[autoAddVestiges] = true }
}

/** Turning it on files this period's coupons if the boss is already cleared. Off touches no row. */
internal fun setAutoAddVestiges(
    partyId: Uuid,
    enabled: Boolean,
    now: Instant,
) {
    Party.update({ Party.id eq partyId }) { it[autoAddVestiges] = enabled }
    val config = configOf(partyId)?.takeIf { enabled }
    val reset = config?.let { bossResetOf(it[Party.bossCatalogId]) }
    if (config != null && reset != null) {
        syncAutoVestiges(config[Party.characterId], config[Party.bossCatalogId], periodStartFor(reset, now), now)
    }
}

/**
 * Brings [characterId]'s party pool for [period] in line with its clear: one auto coupon row at the
 * mode and roster it ran with when the boss is cleared, none when it is not or the party is off.
 *
 * Touches only rows the app filed and nobody has spoken for. Does nothing at all while the party has
 * it off, so turning it off never deletes what it filed.
 */
internal fun syncAutoVestiges(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
) {
    val week = weekOf(characterId, bossCatalogId, period) ?: return
    val filed = vestigeRows(week)
    val pieces = wantedPieces(week, characterId)
    val fits = pieces != null && filed.singleOrNull()?.let { stillFits(it, week, pieces) } == true
    val loose = looseAutoRows(filed)
    // Anything a person logged, split or sold is theirs, and the app files no second row beside it.
    if (fits || loose.size < filed.size) return
    if (loose.isNotEmpty()) {
        PartyLoot.deleteWhere { PartyLoot.id inList loose }
        poolChanged(week.partyId)
    }
    if (pieces != null) file(week, bossCatalogId, pieces, now)
}

/** The party this clear is on, when it is one with the setting on. */
private fun weekOf(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): Week? {
    val config =
        partyIdFor(characterId, bossCatalogId)
            ?.let(::configOf)
            ?.takeIf { !it[Party.solo] && it[Party.standing] && it[Party.autoAddVestiges] }
    val vestige = vestigeId()
    val reset = bossResetOf(bossCatalogId)
    return if (config == null || vestige == null || reset == null) {
        null
    } else {
        Week(config, vestige, period, periodAfter(reset, period))
    }
}

/**
 * What the catalog says the party's mode drops in its world, while the boss is cleared and the party
 * is on for the period. Null whenever any of that is unsaid.
 */
private fun wantedPieces(
    week: Week,
    characterId: Uuid,
): Int? {
    val config = week.config
    val ran =
        runsInPeriod(week.partyId, config[Party.oneOff], week.period) &&
            BossClear
                .selectAll()
                .where {
                    (BossClear.characterId eq characterId) and
                        (BossClear.bossCatalogId eq config[Party.bossCatalogId]) and
                        (BossClear.periodStart eq week.period)
                }.firstOrNull()
                ?.get(BossClear.cleared) == true
    val mode = difficultyIn(config, week.period)
    val world = worldOf(config)
    if (!ran || mode == null || world == null) return null
    return BossDropAmount
        .selectAll()
        .where {
            (BossDropAmount.bossCatalogId eq config[Party.bossCatalogId]) and
                (BossDropAmount.difficulty eq mode) and
                (BossDropAmount.world eq world) and
                (BossDropAmount.dropCatalogId eq week.vestige)
        }.firstOrNull()
        ?.get(BossDropAmount.pieces)
        ?.takeIf { it >= 1 }
}

private fun vestigeRows(week: Week): List<ResultRow> =
    PartyLoot
        .selectAll()
        .where {
            (PartyLoot.partyId eq week.partyId) and
                (PartyLoot.dropCatalogId eq week.vestige) and
                (PartyLoot.droppedOn greaterEq week.period) and
                (PartyLoot.droppedOn less week.end)
        }.toList()

/**
 * The row already says what the week says: same count, same mode, and the split the app would choose
 * now, so a roster or Entitled change re-files an untouched row.
 */
private fun stillFits(
    row: ResultRow,
    week: Week,
    pieces: Int,
): Boolean =
    row[PartyLoot.quantity] == pieces &&
        row[PartyLoot.difficulty] == difficultyIn(week.config, week.period) &&
        findLoot(row[PartyLoot.id], week.partyId)?.let { loot ->
            val split = loot.bundlesBy.associate { Uuid.parse(it.memberId) to it.bundles }
            split == (plannedSplit(week.partyId, loot, week.vestige, week.period) ?: emptyMap<Uuid, Int>())
        } == true

/** The rows among [rows] the app filed and nobody has sold, taken, settled or split by hand. */
private fun looseAutoRows(rows: List<ResultRow>): List<Uuid> {
    val candidates =
        rows
            .filter {
                it[PartyLoot.fromClear] && it[PartyLoot.soldAt] == null && it[PartyLoot.takenByMemberId] == null
            }.map { it[PartyLoot.id] }
    val spoken = spokenFor(candidates)
    return candidates.filterNot { it in spoken }
}

private fun file(
    week: Week,
    bossCatalogId: Uuid,
    pieces: Int,
    now: Instant,
) {
    // Today when today is inside the period, as a human would have typed it; else the period's start.
    val on = todayIn(now).takeIf { it >= week.period && it < week.end } ?: week.period
    val lootId =
        addLoot(
            week.partyId,
            LootedDrop(week.vestige, quantity = pieces),
            bossCatalogId,
            on,
            now,
            LootSource(fromClear = true),
        )
    autoSplit(week.partyId, lootId, week.vestige, week.period)
    poolChanged(week.partyId, lootId)
}
