package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootBundle
import com.sharpeyes.backend.db.PartyLootPayout
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.db.SettlementDebtPayout
import com.sharpeyes.backend.db.VestigeSettlementLoot
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The drops half of an unlink's snapshot: which of the reader's own drops a merge replaces, and the
// owner's drops copied over with their sales. See SharedSlice.kt. Inside a transaction, like the rest.

/**
 * For each week the owner logged a drop in: the reader's own drops of it go, and the owner's roster
 * for it is written onto the target so the copied drops divide as they did. A week where one of the
 * reader's drops has been acted on keeps theirs, roster and all, and is returned.
 */
internal fun resolveDuplicateWeeks(
    source: Uuid,
    sourceLoot: List<Uuid>,
    target: Uuid,
    seats: Map<Uuid, Uuid>,
): Set<LocalDate> {
    val ownerWeeks =
        if (sourceLoot.isEmpty()) {
            emptySet()
        } else {
            PartyLoot.selectAll().where { PartyLoot.id inList sourceLoot }.mapTo(
                mutableSetOf(),
            ) { weekOf(it[PartyLoot.droppedOn]) }
        }
    val theirs = PartyLoot.selectAll().where { PartyLoot.partyId eq target }.toList()
    val keep = mutableSetOf<LocalDate>()
    for (week in ownerWeeks) {
        val duplicates = theirs.filter { weekOf(it[PartyLoot.droppedOn]) == week }.map { it[PartyLoot.id] }
        if (duplicates.any(::actedOn)) {
            keep += week
            continue
        }
        deleteLoot(duplicates)
        writeRosterOf(source, target, week, seats)
    }
    return keep
}

/** Sold, kept, closed over or offset against: a drop somebody has done something with. */
private fun actedOn(lootId: Uuid): Boolean {
    val row = PartyLoot.selectAll().where { PartyLoot.id eq lootId }.single()
    return row[PartyLoot.soldAt] != null ||
        row[PartyLoot.takenByMemberId] != null ||
        !VestigeSettlementLoot.selectAll().where { VestigeSettlementLoot.lootId eq lootId }.empty() ||
        !SettlementDebtPayout.selectAll().where { SettlementDebtPayout.lootId eq lootId }.empty()
}

private fun deleteLoot(ids: List<Uuid>) {
    if (ids.isEmpty()) return
    PartyLootPayout.deleteWhere { PartyLootPayout.lootId inList ids }
    PartyLootBundle.deleteWhere { PartyLootBundle.lootId inList ids }
    PartyLoot.deleteWhere { PartyLoot.id inList ids }
}

/** [source]'s roster and shares for [week], spelled out on [target] in its place. */
private fun writeRosterOf(
    source: Uuid,
    target: Uuid,
    week: LocalDate,
    seats: Map<Uuid, Uuid>,
) {
    val roster = rosterFor(source, week)
    val weekShares = weekSharesFor(listOf(source), week)[source].orEmpty()
    val standingShares =
        PartyMember.selectAll().where { PartyMember.partyId eq source }.associate {
            it[PartyMember.id] to
                it[PartyMember.shares]
        }
    PartyWeekSeat.deleteWhere { (PartyWeekSeat.partyId eq target) and (PartyWeekSeat.weekStart eq week) }
    for (member in roster) {
        val seat = seats[member] ?: continue
        PartyWeekSeat.insert {
            it[partyId] = target
            it[weekStart] = week
            it[memberId] = seat
            it[shares] = weekShares[member] ?: standingShares[member]
        }
    }
}

/**
 * Every drop of [copy]'s source, with its sale, payouts and stacks, onto the target. Logged by the
 * reader now, it being their book: "whoever logged it sells it" would otherwise lock them out of
 * selling a drop the owner logged and can no longer reach. Returns each old drop id's new one.
 */
internal fun copyLoot(
    copy: PartyCopy,
    now: Instant,
): Map<Uuid, Uuid> {
    if (copy.sourceLoot.isEmpty()) return emptyMap()
    val rows =
        PartyLoot
            .selectAll()
            .where { PartyLoot.id inList copy.sourceLoot }
            .filter { weekOf(it[PartyLoot.droppedOn]) !in copy.keepTheirs }
    val ids = rows.associate { it[PartyLoot.id] to Uuid.random() }
    for (row in rows) insertCopiedLoot(row, copy, ids.getValue(row[PartyLoot.id]), now)
    val old = ids.keys.toList()
    PartyLootPayout.selectAll().where { PartyLootPayout.lootId inList old }.forEach { row ->
        val seat = copy.seats[row[PartyLootPayout.memberId]] ?: return@forEach
        PartyLootPayout.insert {
            it[lootId] = ids.getValue(row[PartyLootPayout.lootId])
            it[memberId] = seat
            it[paid] = row[PartyLootPayout.paid]
            it[paidAt] = row[PartyLootPayout.paidAt]
            it[shares] = row[PartyLootPayout.shares]
        }
    }
    PartyLootBundle.selectAll().where { PartyLootBundle.lootId inList old }.forEach { row ->
        val seat = copy.seats[row[PartyLootBundle.memberId]] ?: return@forEach
        PartyLootBundle.insert {
            it[lootId] = ids.getValue(row[PartyLootBundle.lootId])
            it[memberId] = seat
            it[bundles] = row[PartyLootBundle.bundles]
        }
    }
    return ids
}

private fun insertCopiedLoot(
    row: ResultRow,
    copy: PartyCopy,
    newId: Uuid,
    now: Instant,
) {
    PartyLoot.insert {
        it[id] = newId
        it[partyId] = copy.target
        it[dropCatalogId] = row[PartyLoot.dropCatalogId]
        it[customName] = row[PartyLoot.customName]
        it[bossCatalogId] = row[PartyLoot.bossCatalogId]
        it[droppedOn] = row[PartyLoot.droppedOn]
        it[quantity] = row[PartyLoot.quantity]
        it[difficulty] = row[PartyLoot.difficulty]
        it[fromClear] = row[PartyLoot.fromClear]
        it[solo] = row[PartyLoot.solo]
        it[soldAt] = row[PartyLoot.soldAt]
        it[saleAmount] = row[PartyLoot.saleAmount]
        it[saleUsdCents] = row[PartyLoot.saleUsdCents]
        it[amountBasis] = row[PartyLoot.amountBasis]
        it[splitMethod] = row[PartyLoot.splitMethod]
        it[sellerShares] = row[PartyLoot.sellerShares]
        it[sellerMemberId] = row[PartyLoot.sellerMemberId]?.let(copy.seats::get)
        it[takenByMemberId] = row[PartyLoot.takenByMemberId]?.let(copy.seats::get)
        it[recordedByUserId] = null
        it[createdAt] = row[PartyLoot.createdAt]
        it[updatedAt] = now
    }
}
