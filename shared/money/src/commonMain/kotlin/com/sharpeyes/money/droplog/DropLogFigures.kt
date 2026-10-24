package com.sharpeyes.money.droplog

import com.sharpeyes.money.DropLogPage
import com.sharpeyes.money.PartyLootPool
import com.sharpeyes.money.SharedBook
import com.sharpeyes.money.TaggedMapSerializer
import com.sharpeyes.money.coupons.HolderLedger
import com.sharpeyes.money.coupons.PaymentSplit
import com.sharpeyes.money.coupons.SELF_KEY
import com.sharpeyes.money.coupons.UnansweredDrop
import com.sharpeyes.money.coupons.closedByHolder
import com.sharpeyes.money.coupons.couponMoney
import com.sharpeyes.money.coupons.holderKey
import com.sharpeyes.money.coupons.paymentsSinceClosing
import com.sharpeyes.money.coupons.runningBalance
import com.sharpeyes.money.coupons.stillOpen
import com.sharpeyes.money.coupons.unanswered
import com.sharpeyes.money.lots.SaleQueues
import com.sharpeyes.money.lots.saleQueues
import com.sharpeyes.money.pieces.heldOfYoursBy
import com.sharpeyes.money.pieces.outstandingOf
import com.sharpeyes.money.pieces.owedByCreditor
import com.sharpeyes.money.pieces.stillAsking
import com.sharpeyes.money.pieces.worthDrawing
import com.sharpeyes.money.settlement.CardView
import com.sharpeyes.money.settlement.PileCard
import com.sharpeyes.money.settlement.SettlementView
import com.sharpeyes.money.settlement.SplittableDebt
import com.sharpeyes.money.settlement.VESTIGE
import com.sharpeyes.money.settlement.cardView
import com.sharpeyes.money.settlement.decidedSales
import com.sharpeyes.money.settlement.pileCard
import com.sharpeyes.money.settlement.settlementView
import com.sharpeyes.money.settlement.splittableDebts
import com.sharpeyes.money.settlement.yourPiles
import com.sharpeyes.money.shared.DecidedSerializer
import com.sharpeyes.money.shared.SharedCard
import com.sharpeyes.money.shared.SharedPile
import com.sharpeyes.money.shared.loggedTwice
import com.sharpeyes.money.shared.sharedCard
import com.sharpeyes.money.shared.sharedHistory
import com.sharpeyes.money.shared.sharedPile
import com.sharpeyes.money.shared.withoutLoot
import kotlinx.serialization.Serializable

// Every figure the Drop Log and its cards draw, off one account's two payloads: its own page and the
// books other owners keep with it. The composition app/bosses/drops/page.tsx runs today, and what the
// backend serves in its place (docs/backend-arithmetic-plan.md, Phase 3).

/** A pile somebody who signs in holds, netted the way their own card nets it. */
@Serializable
data class TheirPile(
    val ledger: HolderLedger,
    @Serializable(with = TaggedMapSerializer::class)
    val heldOfYours: Map<String, Double>,
)

@Serializable
data class SalesByLogger(
    val yours: SaleQueues,
    val theirs: SaleQueues,
)

@Serializable
data class DropLogFigures(
    /** Drops of yours a shared party already records, by loot id, naming whose party has it. */
    @Serializable(with = TaggedMapSerializer::class)
    val twice: Map<String, String>,
    val view: SettlementView,
    /** One per book, in order; null where the book says nothing about you. */
    val sharedCards: List<SharedCard?>,
    val sharedPiles: List<SharedPile?>,
    val log: DropLog,
    val settledRows: List<SettledRecord>,
    val settledTotals: SettledTotals,
    val orphans: Double,
    val unanswered: List<UnansweredDrop>,
    @Serializable(with = TaggedMapSerializer::class)
    val behind: Map<String, Double>,
    @Serializable(with = TaggedMapSerializer::class)
    val paymentsByHolder: Map<String, PaymentSplit>,
    @Serializable(with = DecidedSerializer::class)
    val decided: Map<String, Set<String>>,
    val drawn: List<HolderLedger>,
    @Serializable(with = TaggedMapSerializer::class)
    val heldOfYours: Map<String, Double>,
    val theirPiles: List<TheirPile>,
    val pendingSplits: List<SplittableDebt>,
    val sales: SalesByLogger,
    /** One per settlement card, in the cards' order. */
    val cards: List<CardView>,
    /** Your drawn piles, then the linked holders' piles, then one per shared book (null where none). */
    val piles: List<PileCard?>,
    /** Every drop's own page, in the drop page's log order. See dropAudits. */
    val audits: List<DropAudit?>,
)

/** The pools cut by who logged each drop: whoever logged it sells it. */
private fun byLogger(
    pools: List<PartyLootPool>,
    yours: Boolean,
): List<PartyLootPool> =
    pools
        .map { pool ->
            pool.copy(loot = pool.loot.filter { (it.recordedByYou != false) == yours })
        }.filter { it.loot.isNotEmpty() }

/** What the Sale Ledger draws: your piles worth a card, and linked holders' piles still owing. */
private class SaleLedger(
    page: DropLogPage,
    view: SettlementView,
) {
    val paymentsByHolder = paymentsSinceClosing(page.payments, page.settlements)
    val decided = decidedSales(view.credits, page.disposals)
    val tranchesByHolder = page.tranches.groupBy { holderKey(it.holder) }
    val heldOfYours = heldOfYoursBy(view.ledgers)
    private val yours = yourPiles(view.ledgers)
    val drawn = worthDrawing(yours, ::recorded, heldOfYours).first
    val theirPiles = theirPiles(page, view.ledgers, yours.firstOrNull())

    /** Whether a pile has anything recorded against it still asking: a tranche or a receipt. */
    private fun recorded(key: String): Boolean {
        val receipts = paymentsByHolder[key]
        val asking = stillAsking(tranchesByHolder[key] ?: emptyList(), decided).isNotEmpty()
        return asking || (receipts?.counted?.isNotEmpty() ?: false) || (receipts?.spent?.isNotEmpty() ?: false)
    }

    private fun theirPiles(
        page: DropLogPage,
        ledgers: List<HolderLedger>,
        ownPile: HolderLedger?,
    ): List<TheirPile> {
        val linked =
            page.people
                .filter { it.linked }
                .map { "person:${it.id}" }
                .toSet()
        return ledgers
            .filter { !it.closed && holderKey(it.holder) in linked }
            .map { ledger ->
                val owedThem =
                    ownPile?.let { own -> owedByCreditor(own).find { it.key == holderKey(ledger.holder) }?.pieces }
                        ?: 0.0
                TheirPile(ledger, if (owedThem > 0) mapOf(SELF_KEY to owedThem) else emptyMap())
            }.filter { outstandingOf(it.ledger, it.heldOfYours) > 0 }
    }

    fun piles(sharedPiles: List<SharedPile?>): List<PileCard?> {
        val pileOf = { ledger: HolderLedger -> tranchesByHolder[holderKey(ledger.holder)] ?: emptyList() }
        val shared =
            sharedPiles.map { p ->
                p?.let {
                    pileCard(
                        it.ledger,
                        it.heldOfYours,
                        it.tranches[holderKey(it.ledger.holder)] ?: emptyList(),
                        it.decided,
                    )
                }
            }
        return drawn.map { pileCard(it, heldOfYours, pileOf(it), decided) } +
            theirPiles.map { pileCard(it.ledger, it.heldOfYours, pileOf(it.ledger), decided) } +
            shared
    }
}

fun dropLogFigures(
    page: DropLogPage,
    books: List<SharedBook>,
): DropLogFigures {
    val shared = sharedHistory(books)
    val ownerOf = LinkedHashMap<String, String>()
    for (book in books) book.parties.forEach { ownerOf[it.id] = book.ownerName }
    val twice = loggedTwice(page.parties to page.pools, shared, ownerOf)
    // A run in both your party and theirs counts once, as the owner's copy.
    val counted = withoutLoot(page.pools, twice)
    val view = settlementView(page.copy(pools = counted))
    val logParties = page.parties + shared.parties
    val logPools = counted + shared.pools
    val log =
        buildDropLog(
            logParties,
            logPools,
            page.drops,
            view.closures.closed + closedByHolder(shared.settlements).closed,
        )
    val settlements = page.settlements + shared.settlements
    val settledRows = buildSettledLog(log.entries, settlements, view.holderNames + shared.names)
    val sale = SaleLedger(page, view)
    val sharedPiles = books.map { sharedPile(it, page.bosses) }
    val yours = saleQueues(logParties, byLogger(logPools, true), page.drops, SELF_KEY)
    val sales = SalesByLogger(yours, saleQueues(logParties, byLogger(logPools, false), page.drops, SELF_KEY))
    val cards =
        view.settlement.map {
            cardView(it, sale.paymentsByHolder[it.key]?.counted ?: emptyList(), view.offsetShares)
        }
    return DropLogFigures(
        twice = twice,
        view = view,
        sharedCards = books.map { sharedCard(it, page.bosses) },
        sharedPiles = sharedPiles,
        log = log,
        settledRows = settledRows,
        settledTotals = settledTotals(settledRows, couponMoney(page.tranches)),
        orphans = orphansOf(log.entries, settlements),
        unanswered = unanswered(page.parties, counted, VESTIGE),
        behind = runningBalance(stillOpen(view.settled, view.closures.closed)),
        paymentsByHolder = sale.paymentsByHolder,
        decided = sale.decided,
        drawn = sale.drawn,
        heldOfYours = sale.heldOfYours,
        theirPiles = sale.theirPiles,
        pendingSplits = splittableDebts(page.debts, view.offsetShares),
        sales = sales,
        cards = cards,
        piles = sale.piles(sharedPiles),
        audits = dropAudits(page, books),
    )
}
