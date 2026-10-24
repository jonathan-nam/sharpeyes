package com.sharpeyes.backend.money

import kotlinx.serialization.Serializable

// The Settlement stage's figures off the Drop Log payload, intermediates included because the Drop
// Log reads them for its other stages. The port of frontend/lib/settlement-view.ts and the one label
// it draws with (boss-difficulty.ts). Any screen stating these figures calls this rather than
// rebuilding the chain, or two screens disagree about what somebody owes.

/** The stacking drop the piece ledger is for. */
const val VESTIGE = "vestige-of-erion"

@Serializable
data class SettlementView(
    @Serializable(with = TaggedMapSerializer::class)
    val bossOrder: Map<String, Double>,
    val closures: Closures,
    val settled: List<OutstandingDrop>,
    val ledgers: List<HolderLedger>,
    @Serializable(with = TaggedMapSerializer::class)
    val holderNames: Map<String, String>,
    val wallet: Wallet,
    @Serializable(with = TaggedMapSerializer::class)
    val offsetShares: Map<String, OffsetShare>,
    @Serializable(with = TaggedMapSerializer::class)
    val credits: Map<String, SaleCredit>,
    val settlement: List<Settlement>,
    val totals: SettlementTotals,
)

/** Title case, as the game writes a mode. Stored uppercase. */
fun difficultyLabel(difficulty: String): String = difficulty.take(1) + difficulty.drop(1).lowercase()

/** The boss as it gets said out loud. Just the name when no mode has been picked. */
fun bossLabel(
    name: String,
    difficulty: String? = null,
): String = if (difficulty.isNullOrEmpty()) name else "${difficultyLabel(difficulty)} $name"

/** The coupon's own row, off whichever boss table carries it. */
fun vestigeOf(dropTables: Map<String, List<BossDrop>>): BossDrop? =
    dropTables.values.flatten().find {
        it.dropKey ==
            VESTIGE
    }

/** Who a debt can name: the people list first, then seats, which carry the name as this account spells it. */
private fun holderNamesOf(page: DropLogPage): Map<String, String> {
    val names = LinkedHashMap<String, String>()
    for (person in page.people) names["person:${person.id}"] = person.name
    for (seat in page.parties.flatMap { foldSeats(it.seats) }) names[seat.key] = seat.name
    return names
}

/** The shares an offset discharged, resolved off the pools: only the drops an offset names. */
private fun offsetSharesOf(page: DropLogPage): Map<String, OffsetShare> {
    val out = LinkedHashMap<String, OffsetShare>()
    val wanted = page.debts.flatMap { d -> d.payouts.map { it.lootId } }.toSet()
    val partyById = page.parties.associateBy { it.id }
    val bossByKey = page.bosses.associateBy { it.bossKey }
    for (pool in page.pools.filter { partyById.containsKey(it.partyId) }) {
        val party = partyById.getValue(pool.partyId)
        for (loot in pool.loot.filter { it.id in wanted }) {
            val split = splitOf(loot, party.seats) ?: continue
            val boss = bossByKey[loot.bossKey ?: ""]
            for (share in split.shares) {
                val key = shareKey(loot.id, share.memberId)
                out[key] =
                    OffsetShare(
                        key = key,
                        lootId = loot.id,
                        memberId = share.memberId,
                        item = loot.name,
                        iconUrl = loot.iconUrl,
                        boss = boss?.let { bossLabel(it.name, party.difficulty) } ?: "–",
                        members = split.shares.map { it.name },
                        on = loot.droppedOn,
                        weekStart = loot.weekStart,
                        share = share.pay,
                        sale = saleMoney(loot)?.amount,
                        currency = split.currency,
                        partyId = pool.partyId,
                    )
            }
        }
    }
    return out
}

/** The Settlement stage's figures off the Drop Log payload. */
fun settlementView(page: DropLogPage): SettlementView {
    val bossOrder = LinkedHashMap<String, Double>()
    page.bosses.forEachIndexed { i, b -> bossOrder[b.bossKey] = i.toDouble() }
    val closures = closedByHolder(page.settlements)
    val settled = outstanding(page.parties, page.pools, VESTIGE, bossOrder)
    val inputs =
        LedgerInputs(
            salesByHolder = salesByHolder(page.tranches),
            keptByHolder = keptByHolder(page.tranches),
            boughtByHolder = boughtByHolder(page.tranches),
            receivedByHolder = receivedByHolder(page.payments),
            closures = closures,
            answeredByHolder = answeredByHolder(page.tranches),
            answeredByPair = answeredSalesByPair(page.tranches),
        )
    val ledgers = holderLedgers(settled + alsoHeldByYou(page.parties, page.pools, VESTIGE, bossOrder, settled), inputs)
    val holderNames = holderNamesOf(page)
    val wallet = buildWallet(page.parties, page.pools)
    val credits = saleCredits(page.tranches)
    val pinned =
        page.people
            .filter { it.pinned }
            .map { "person:${it.id}" }
            .toCollection(LinkedHashSet())
    val settlement =
        buildSettlement(
            ledgers,
            wallet,
            SettlementInputs(
                debts = page.debts,
                credits = credits,
                received = receivedSinceClosing(page.payments, page.settlements),
                names = holderNames,
                pinned = pinned,
                answered = answeredSalesByPair(page.tranches),
                disposals = page.disposals,
            ),
        )
    return SettlementView(
        bossOrder,
        closures,
        settled,
        ledgers,
        holderNames,
        wallet,
        offsetSharesOf(page),
        credits,
        settlement,
        settlementTotals(settlement),
    )
}
