package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import com.maplestorage.backend.users.activeWorldFor
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.alias
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// The loot pool's reads, and the status every row's shape is derived from. Writes are in
// LootWrites.kt. Inside a transaction, like the rest. Nothing here computes money: see LootDtos.kt.

/** Not sold yet. */
internal const val STATUS_PENDING = "PENDING"

/** Sold, and somebody in the pinned roster is still unpaid. */
internal const val STATUS_SOLD = "SOLD"

/** Sold and everyone has been paid. */
internal const val STATUS_PAID_OUT = "PAID_OUT"

/**
 * Somebody took the item, in a world where it cannot be sold.
 *
 * Terminal, like PAID_OUT, and for the same reason: there is nothing left to do with it. Not called
 * PAID_OUT anyway, because nobody paid anybody. See V49.
 */
internal const val STATUS_TAKEN = "TAKEN"

// BOUGHT is a party member buying the drop off the party: no Auction House cut came off the top,
// and sellerMemberId is the buyer. See V29__loot_bought_by_member.sql.
internal val AMOUNT_BASES = setOf("LISTED", "RECEIVED", "BOUGHT")
internal val SPLIT_METHODS = setOf("LAZY", "FAIR")

/** The character a loot row's amount is read against, kept out of any caller's own Characters join. */
private val amountWorld = Characters.alias("amount_world")

/**
 * A drop with its catalog name, icon and boss attached, which is every read of the pool.
 *
 * Party is joined for its difficulty, and the character behind it for its world: those are the third
 * and fourth keys of the amount row, since how many drop and in how many stacks is per (boss,
 * difficulty, world). A party with no difficulty set joins nothing and the drop's bundle count comes
 * back null, which is the honest answer.
 */
private fun lootWithCatalog() =
    PartyLoot
        .join(DropCatalog, JoinType.LEFT, PartyLoot.dropCatalogId, DropCatalog.id)
        .join(BossCatalog, JoinType.LEFT, PartyLoot.bossCatalogId, BossCatalog.id)
        .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
        // Through the character, which is where the world lives. Without it the amount table matches
        // TWICE, once per world, and every drop comes back doubled.
        //
        // ALIASED, because callers of this join Characters themselves and Postgres refuses the same
        // table name twice in one FROM. The alias is this join's own and belongs to nobody else.
        .join(amountWorld, JoinType.LEFT, Party.characterId, amountWorld[Characters.id])
        .join(BossDropAmount, JoinType.LEFT) {
            (BossDropAmount.bossCatalogId eq PartyLoot.bossCatalogId) and
                (BossDropAmount.dropCatalogId eq PartyLoot.dropCatalogId) and
                (BossDropAmount.difficulty eq Party.difficulty) and
                (BossDropAmount.world eq amountWorld[Characters.worldType])
        }

/** Who is owed on these drops, in one query rather than one per drop. */
private fun payoutsFor(lootIds: List<Uuid>): Map<Uuid, List<LootPayoutResponse>> =
    PartyLootPayout
        .selectAll()
        .where { PartyLootPayout.lootId inList lootIds }
        .groupBy({ it[PartyLootPayout.lootId] }) {
            LootPayoutResponse(
                memberId = it[PartyLootPayout.memberId].toString(),
                paid = it[PartyLootPayout.paid],
                paidAt = it[PartyLootPayout.paidAt]?.toString(),
                shares = it[PartyLootPayout.shares],
            )
        }

/**
 * The seats that ran each drop's own week, keyed by drop.
 *
 * A drop belongs to the week it fell in, so that is the roster it is measured against: who could
 * have sold it, and who a sale owes. Batched a week at a time rather than asked per drop, since a
 * pool is usually a handful of drops spread over very few weeks.
 */
private fun ranThatWeekFor(rows: List<ResultRow>): Map<Uuid, List<String>> {
    val rostersByWeek =
        rows
            .groupBy({ weekOf(it[PartyLoot.droppedOn]) }) { it[PartyLoot.partyId] }
            .mapValues { (week, partyIds) -> rostersFor(partyIds.distinct(), week) }

    return rows.associate { row ->
        val ran = rostersByWeek[weekOf(row[PartyLoot.droppedOn])]?.get(row[PartyLoot.partyId])
        row[PartyLoot.id] to ran.orEmpty().map { it.toString() }
    }
}

/**
 * The share each seat was on in each drop's own week, keyed by drop.
 *
 * Only where a week named one. Empty is every seat on its standing share, which is every week
 * nobody has changed the deal behind, and is what all of them held before V55.
 *
 * Carried beside ranThatWeek and for the same reason: a drop belongs to the week it fell in, and
 * the deal that divides it is the one that was in force THEN. Without this the pinning is a table
 * nobody reads, and agreeing a new split re-divides every outstanding drop by it.
 */
private fun sharesThatWeekFor(rows: List<ResultRow>): Map<Uuid, Map<String, Int>> {
    val sharesByWeek =
        rows
            .groupBy({ weekOf(it[PartyLoot.droppedOn]) }) { it[PartyLoot.partyId] }
            .mapValues { (week, partyIds) -> weekSharesFor(partyIds.distinct(), week) }

    return rows.associate { row ->
        val shares = sharesByWeek[weekOf(row[PartyLoot.droppedOn])]?.get(row[PartyLoot.partyId])
        row[PartyLoot.id] to shares.orEmpty().mapKeys { it.key.toString() }
    }
}

internal fun lootFor(partyId: Uuid): List<LootResponse> {
    val rows =
        lootWithCatalog()
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            // Newest first: the pool is a worklist, and the drop you just logged is the one you
            // are about to sell.
            .orderBy(PartyLoot.droppedOn to SortOrder.DESC, PartyLoot.createdAt to SortOrder.DESC)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val payoutsByLoot = payoutsFor(rows.map { it[PartyLoot.id] })
    val ranByLoot = ranThatWeekFor(rows)
    val sharesByLoot = sharesThatWeekFor(rows)
    val bundlesByLoot = bundlesFor(rows.map { it[PartyLoot.id] })
    return rows.map {
        it.toLootResponse(
            payoutsByLoot[it[PartyLoot.id]].orEmpty(),
            ranByLoot[it[PartyLoot.id]].orEmpty(),
            sharesByLoot[it[PartyLoot.id]].orEmpty(),
            bundlesByLoot[it[PartyLoot.id]].orEmpty(),
        )
    }
}

/**
 * Every pool this account has, in three queries rather than three per party.
 *
 * For the wallet, which nets what you owe against what you are owed and so has to see all of them
 * at once. The rows are the same ones lootFor() returns, ungrouped and re-grouped here: a second
 * shape for the same drop is a second thing to keep in step.
 */
internal fun allLootFor(userId: String): List<PartyLootPoolResponse> {
    val rows =
        lootWithCatalog()
            // For the world lens only. The pool itself needs nothing from the character, but the
            // Drop Log and the Wallet both sum across every party, and summing across two worlds
            // would add mesos that cannot be earned to mesos that can.
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { (Party.userId eq userId) and (Characters.worldType eq activeWorldFor(userId)) }
            .orderBy(PartyLoot.droppedOn to SortOrder.DESC, PartyLoot.createdAt to SortOrder.DESC)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val payoutsByLoot = payoutsFor(rows.map { it[PartyLoot.id] })
    val ranByLoot = ranThatWeekFor(rows)
    val sharesByLoot = sharesThatWeekFor(rows)
    val bundlesByLoot = bundlesFor(rows.map { it[PartyLoot.id] })
    val response = { row: ResultRow ->
        row.toLootResponse(
            payoutsByLoot[row[PartyLoot.id]].orEmpty(),
            ranByLoot[row[PartyLoot.id]].orEmpty(),
            sharesByLoot[row[PartyLoot.id]].orEmpty(),
            bundlesByLoot[row[PartyLoot.id]].orEmpty(),
        )
    }
    // groupBy keeps the order rows arrived in, so each pool stays newest-first.
    return rows
        .groupBy { it[PartyLoot.partyId] }
        .map { (partyId, pool) ->
            PartyLootPoolResponse(partyId = partyId.toString(), loot = pool.map(response))
        }
}

internal fun findLoot(
    lootId: Uuid,
    partyId: Uuid,
): LootResponse? = lootFor(partyId).firstOrNull { it.id == lootId.toString() }

/**
 * Seats that cannot be removed from a party because loot history points at them.
 *
 * Refusing beats cascading: a payout row is the record that somebody was paid, and deleting the
 * seat would delete the record while leaving the money real.
 */
internal fun seatsWithLootHistory(partyId: Uuid): Set<Uuid> {
    val sellers =
        PartyLoot
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            .mapNotNull { it[PartyLoot.sellerMemberId] }
    val owed =
        PartyLootPayout
            .innerJoin(PartyLoot)
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            .map { it[PartyLootPayout.memberId] }
    return (sellers + owed).toSet()
}

/** Derived, never stored, so it cannot drift from the sale and the payout rows it reads. */
private fun statusOf(
    sold: Boolean,
    taken: Boolean,
    payouts: List<LootPayoutResponse>,
): String =
    when {
        // Before sold, though the two cannot both be true (party_loot_sold_or_taken). Checking the
        // exclusive pair in a fixed order means a constraint that ever lapses shows up as one
        // status rather than as two readings of the same row in different callers.
        taken -> STATUS_TAKEN
        !sold -> STATUS_PENDING
        payouts.all { it.paid } -> STATUS_PAID_OUT
        else -> STATUS_SOLD
    }

private fun ResultRow.toLootResponse(
    payouts: List<LootPayoutResponse>,
    ranThatWeek: List<String>,
    sharesThatWeek: Map<String, Int>,
    bundlesBy: List<LootBundleResponse>,
): LootResponse {
    val sold = this[PartyLoot.soldAt] != null
    val takenBy = this[PartyLoot.takenByMemberId]?.toString()
    return LootResponse(
        id = this[PartyLoot.id].toString(),
        dropKey = this.getOrNull(DropCatalog.dropKey),
        customName = this[PartyLoot.customName],
        // One of the two is always set (party_loot_named_once), so this cannot fall through to a
        // blank row.
        name = this.getOrNull(DropCatalog.name) ?: this[PartyLoot.customName].orEmpty(),
        iconUrl = this.getOrNull(DropCatalog.iconRefKey)?.let { "/drop-icons/$it" },
        perMember = this.getOrNull(DropCatalog.perMember),
        bossKey = this.getOrNull(BossCatalog.bossKey),
        quantity = this[PartyLoot.quantity],
        droppedOn = this[PartyLoot.droppedOn].toString(),
        weekStart = weekOf(this[PartyLoot.droppedOn]).toString(),
        status = statusOf(sold, takenBy != null, payouts),
        saleAmount = this[PartyLoot.saleAmount],
        amountBasis = this[PartyLoot.amountBasis],
        splitMethod = this[PartyLoot.splitMethod],
        sellerShares = this[PartyLoot.sellerShares],
        sellerMemberId = this[PartyLoot.sellerMemberId]?.toString(),
        looterMemberId = this[PartyLoot.looterMemberId]?.toString(),
        takenByMemberId = takenBy,
        soldAt = this[PartyLoot.soldAt]?.toString(),
        payouts = payouts,
        ranThatWeek = ranThatWeek,
        sharesThatWeek = sharesThatWeek,
        bundles = this.getOrNull(BossDropAmount.bundles),
        bundlesBy = bundlesBy,
    )
}
