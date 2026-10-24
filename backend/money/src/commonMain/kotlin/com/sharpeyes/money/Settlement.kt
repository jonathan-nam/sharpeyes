package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.min

// What stands between you and each other person, in one place. The port of buildSettlement in
// frontend/lib/settlement.ts, which explains each rule. MONEY is one net figure; PIECES stay a count.
// What you owe in shares stays outside the net until Offset or Mark Sent says which way it goes.

/** One night's coupons sitting in the wrong inventory, in whichever direction it runs. */
@Serializable
data class HeldOfYours(
    override val lootId: String,
    val partyId: String,
    val bossKey: String? = null,
    override val weekStart: String,
    override val droppedOn: String,
    override val recordedAt: String? = null,
    override val pieces: Double,
    val sold: Double,
    val looterName: String,
    val ran: List<String>,
    val shared: Boolean,
) : PlaceableNight<HeldOfYours> {
    override fun withPieces(pieces: Double) = copy(pieces = pieces)
}

@Serializable
data class PiecesAnswered(
    var yours: Double = 0.0,
    var theirs: Double = 0.0,
)

/** What the net is made of, every one signed towards you. Summed in this order. */
@Serializable
data class Parts(
    var shares: Double = 0.0,
    var entered: Double = 0.0,
    var soldOfTheirs: Double = 0.0,
    var soldOfYours: Double = 0.0,
    var offsetOfYours: Double = 0.0,
    var received: Double = 0.0,
) {
    fun sum(): Double = shares + entered + soldOfTheirs + soldOfYours + offsetOfYours + received
}

/** One person, and everything that stands between you. See Settlement in settlement.ts. */
@Serializable
data class Settlement(
    val key: String,
    val name: String,
    val attributed: Boolean,
    val holder: Holder,
    var pieces: Double = 0.0,
    var piecesYouOwe: Double = 0.0,
    val piecesAnswered: PiecesAnswered = PiecesAnswered(),
    var piecesNet: Double = 0.0,
    var mesos: Double = 0.0,
    var owedByYou: Double = 0.0,
    var sharesYouOwe: Double = 0.0,
    var usd: Owings = Owings(),
    val parts: Parts = Parts(),
    var holding: Double = 0.0,
    val sales: MutableList<CouponSale> = mutableListOf(),
    var heldByThem: Double = 0.0,
    val salesHeldByThem: MutableList<CouponSale> = mutableListOf(),
    val disposals: MutableList<ProceedsDisposal> = mutableListOf(),
    var pinned: Boolean = false,
    val entries: MutableList<SettlementDebt> = mutableListOf(),
    var drops: List<HeldOfYours> = emptyList(),
    var owedDrops: List<HeldOfYours> = mutableListOf(),
    var owedNights: List<HeldOfYours> = emptyList(),
    var lines: List<WalletLine> = emptyList(),
)

private fun blank(
    key: String,
    name: String,
) = Settlement(key = key, name = name, attributed = key.startsWith("person:"), holder = holderFromKey(key))

/** What buildSettlement reads besides the ledgers and the wallet. Each absent is none. */
data class SettlementInputs(
    val debts: List<SettlementDebt> = emptyList(),
    val credits: Map<String, SaleCredit> = emptyMap(),
    val received: Map<String, Double> = emptyMap(),
    val names: Map<String, String> = emptyMap(),
    val pinned: Set<String> = emptySet(),
    val answered: Map<String, List<AnsweredSale>> = emptyMap(),
    val disposals: List<ProceedsDisposal> = emptyList(),
)

/** Each spent night with what the spend took off it. Same order in and out. */
private fun withSold(
    before: List<HeldOfYours>,
    after: List<HeldOfYours>,
): List<HeldOfYours> = after.mapIndexed { i, night -> night.copy(sold = before[i].pieces - night.pieces) }

private class SettlementBuilder(
    private val inputs: SettlementInputs,
) {
    val out = LinkedHashMap<String, Settlement>()

    fun rowFor(
        key: String,
        name: String? = null,
    ): Settlement = out.getOrPut(key) { blank(key, name ?: inputs.names[key] ?: key) }

    /** Pieces of theirs in YOUR pile, per person, off your own ledger's transfers. */
    fun yourPile(ledgers: List<HolderLedger>) {
        for (ledger in ledgers.filter { it.holder.kind == SELF && !it.closed }) {
            for (drop in ledger.drops.filterNot { it.closed }) {
                val owing = drop.transfers.filter { it.toId != SELF_KEY }
                for (transfer in owing) {
                    val row = rowFor(transfer.toId, transfer.to)
                    row.piecesYouOwe += transfer.pieces
                    row.owedDrops += nightOf(drop, transfer.pieces, owing.any { it.toId != transfer.toId })
                }
            }
        }
        // Off each, the pieces a sale of yours already spoke for.
        for ((key, row) in out) {
            row.owedNights = row.owedDrops
            val spent =
                withSold(
                    row.owedDrops,
                    spendSales(
                        row.owedDrops,
                        inputs.answered[answeredKey(SELF_KEY, key)] ?: emptyList(),
                    ),
                )
            row.piecesAnswered.theirs = row.piecesYouOwe - spent.fold(0.0) { sum, d -> sum + d.pieces }
            row.piecesYouOwe -= row.piecesAnswered.theirs
            row.owedDrops = spent
        }
    }

    /** Their piles: only the open drops, and only the part of each that is YOURS. */
    fun theirPiles(ledgers: List<HolderLedger>) {
        for (ledger in ledgers.filter { it.holder.kind != SELF && !it.closed }) {
            val drops =
                ledger.drops
                    .filterNot { it.closed }
                    .map { d ->
                        val mine = d.transfers.filter { it.toId == SELF_KEY }.fold(0.0) { sum, t -> sum + t.pieces }
                        nightOf(d, mine, d.transfers.any { it.toId != SELF_KEY })
                    }.filter { it.pieces > 0 }
            if (drops.isEmpty()) continue
            val key = holderKey(ledger.holder)
            val row = rowFor(key, ledger.holderName)
            val spent = withSold(drops, spendSales(drops, inputs.answered[answeredKey(key, SELF_KEY)] ?: emptyList()))
            row.piecesAnswered.yours = ledger.owedToYou - spent.fold(0.0) { sum, d -> sum + d.pieces }
            row.pieces = ledger.owedToYou - row.piecesAnswered.yours
            row.drops = spent
        }
    }

    /** The shares, one direction each, and every line behind them. */
    fun shares(wallet: Wallet) {
        for (person in wallet.counterparties.filter { it.lines.isNotEmpty() }) {
            val row = rowFor(person.key, person.name)
            row.parts.shares = person.owed
            row.sharesYouOwe = person.owe
            row.usd = person.usd
            row.lines = person.lines
        }
    }

    /** Entered debts, coupon-sale money held each way, and what has been decided about it. */
    fun money() {
        for (debt in inputs.debts) {
            val row = rowFor(holderKey(debt.holder))
            row.parts.entered += debt.amount
            row.entries += debt
        }
        for ((key, credit) in inputs.credits) {
            val row = rowFor(key)
            row.holding += credit.toThem
            row.sales += credit.sales
            row.heldByThem += credit.toYou
            row.salesHeldByThem += credit.salesToYou ?: emptyList()
            row.parts.soldOfYours += credit.keptByThem ?: 0.0
        }
        inputs.disposals.forEach(::decide)
        for ((key, paid) in inputs.received) {
            if (key != SELF_KEY && paid != 0.0) rowFor(key).parts.received -= paid
        }
    }

    /** A decision about held money: OFFSET moves it into the net, PAID leaves both. Capped at what is held. */
    private fun decide(disposal: ProceedsDisposal) {
        val row = rowFor(holderKey(disposal.holder))
        row.disposals += disposal
        if (heldByThem(disposal)) {
            val spent = min(row.heldByThem, disposal.amount)
            row.heldByThem -= spent
            if (disposal.kind == "OFFSET") row.parts.offsetOfYours += spent
        } else {
            val spent = min(row.holding, disposal.amount)
            row.holding -= spent
            if (disposal.kind == "OFFSET") row.parts.soldOfTheirs -= spent
        }
    }

    /** The net either way, pinned cards kept, and the coupon counts washed into one handover. */
    fun finish() {
        for (row in out.values) {
            val net = row.parts.sum()
            row.mesos = max(0.0, net)
            row.owedByYou = max(0.0, -net)
        }
        for (key in inputs.pinned) rowFor(key).pinned = true
        for (row in out.values) {
            val wash = min(row.pieces, row.piecesYouOwe)
            row.pieces -= wash
            row.piecesYouOwe -= wash
            row.piecesNet = row.piecesYouOwe - row.pieces
        }
    }
}

/** One night of a ledger, as this card holds it: [pieces] of it, [shared] with somebody else. */
private fun nightOf(
    drop: LedgerEntry,
    pieces: Double,
    shared: Boolean,
) = HeldOfYours(
    lootId = drop.lootId,
    partyId = drop.partyId,
    bossKey = drop.bossKey,
    weekStart = drop.weekStart,
    droppedOn = drop.droppedOn,
    recordedAt = drop.recordedAt,
    pieces = pieces,
    sold = 0.0,
    looterName = drop.looterName,
    ran = drop.ran,
    shared = shared,
)

/** Anything left for somebody to act on, or a card somebody pinned. */
private fun drawn(row: Settlement): Boolean =
    row.pinned ||
        row.mesos > 0 ||
        row.owedByYou > 0 ||
        row.sharesYouOwe > 0 ||
        row.usd.owed > 0 ||
        row.usd.owe > 0 ||
        row.pieces > 0 ||
        row.piecesYouOwe > 0 ||
        row.holding > 0 ||
        row.heldByThem > 0

/** Mesos first, then what you owe, dollars, pieces each way, then the name. */
private fun byWhatIsOwed(
    a: Settlement,
    b: Settlement,
): Int =
    listOf(
        b.mesos - a.mesos,
        (b.owedByYou + b.sharesYouOwe) - (a.owedByYou + a.sharesYouOwe),
        b.usd.owed - a.usd.owed,
        b.pieces - a.pieces,
        b.piecesYouOwe - a.piecesYouOwe,
    ).map(::compareNumbers).firstOrNull { it != 0 } ?: localeCompare(a.name, b.name)

/** One row per person who owes you something or whom you owe, from both ledgers at once. */
fun buildSettlement(
    ledgers: List<HolderLedger>,
    wallet: Wallet,
    inputs: SettlementInputs = SettlementInputs(),
): List<Settlement> {
    val builder = SettlementBuilder(inputs)
    builder.yourPile(ledgers)
    builder.theirPiles(ledgers)
    builder.shares(wallet)
    builder.money()
    builder.finish()
    return builder.out.values
        .filter(::drawn)
        .sortedWith(::byWhatIsOwed)
}
