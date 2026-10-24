package com.sharpeyes.money

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlin.math.abs

// Your card and your pile in somebody else's book, from your side. The port of frontend/lib/
// shared-book.ts and shared-pile.ts. Every figure is the owner's own card's, under the label turned
// round: the owner's arithmetic runs over their book and your row is read back.

@Serializable
data class Removal(
    /** debts, payments or disposals. */
    val kind: String,
    val id: String,
)

@Serializable
data class SendRef(
    val partyId: String,
    val lootId: String,
    val payeeId: String,
)

/** One row of a shared card's detail lists. */
@Serializable
data class SharedPart(
    val key: String,
    val label: String,
    val mesos: Double,
    val by: String? = null,
    val remove: Removal? = null,
    val send: SendRef? = null,
    val iconUrl: String? = null,
)

@Serializable
data class SharedDetail(
    val owe: List<SharedPart>,
    val oweTotal: Double,
    val paid: List<SharedPart>,
    val paidTotal: Double,
    val theyOwe: List<WalletLine>,
    val theyOweEntered: List<SharedPart>,
    val holding: Double,
)

@Serializable
data class SharedCard(
    val name: String,
    val image: String? = null,
    val personId: String,
    val owed: Double,
    val owe: Double,
    val holding: Double,
    val youHold: Double,
    val youHoldSales: List<CouponSale>,
    val holdingSales: List<CouponSale>,
    val piecesOwed: Double,
    val piecesOwe: Double,
    val usd: Owings,
    val detail: SharedDetail,
)

@Serializable
data class SharedPile(
    val personId: String,
    val ownerName: String,
    val ledger: HolderLedger,
    @Serializable(with = TaggedMapSerializer::class)
    val heldOfYours: Map<String, Double>,
    @Serializable(with = TaggedMapSerializer::class)
    val tranches: Map<String, List<VestigeTranche>>,
    @Serializable(with = DecidedSerializer::class)
    val decided: Map<String, Set<String>>,
)

/** Which sales have been decided, per tranche, for which creditors: a tagged map of tagged sets. */
object DecidedSerializer : KSerializer<Map<String, Set<String>>> by TaggedMapSerializer(
    String.serializer(),
    TaggedSetSerializer(String.serializer()),
)

/** The owner's own view of their book, with you on their people list. */
private fun ownersView(
    book: SharedBook,
    bosses: List<Boss>,
): SettlementView {
    val you = Person(id = book.personId, name = book.ownerName, linked = true, pinned = false)
    val page =
        DropLogPage(
            book.parties,
            book.pools,
            book.tranches,
            book.payments,
            book.settlements,
            book.debts,
            book.disposals,
            bosses,
            people = listOf(you),
        )
    return settlementView(page)
}

/** How a shared card names a line: the drop, then the boss in the party's mode. */
private class Where(
    book: SharedBook,
    bosses: List<Boss>,
) {
    private val bossName = bosses.associate { it.bossKey to it.name }
    private val partyById = book.parties.associateBy { it.id }

    fun of(line: WalletLine): String {
        val boss = line.bossKey?.let { bossName[it] } ?: return line.name
        return "${line.name} · ${bossLabel(boss, partyById[line.partyId]?.difficulty)}"
    }
}

/** Who wrote a row, when it was the owner and not you, and whether it is yours to take back. */
private fun writer(
    recordedByYou: Boolean?,
    recordedByName: String?,
    book: SharedBook,
): String? = if (recordedByYou == false) recordedByName ?: book.ownerName else null

private fun enteredPart(
    entry: SettlementDebt,
    book: SharedBook,
) = SharedPart(
    key = entry.id,
    label = entry.note ?: "Entered",
    mesos = abs(entry.amount),
    by = writer(entry.recordedByYou, entry.recordedByName, book),
    remove = if (entry.recordedByYou == true) Removal("debts", entry.id) else null,
)

/** Your shares one drop at a time where they add up to the figure exactly, else the figure alone. */
private fun yourShares(
    row: Settlement,
    where: Where,
): List<SharedPart> {
    val yourLines = row.lines.filter { it.direction == "owed" && it.currency == "MESO" }
    val itemised = yourLines.fold(0.0) { sum, line -> sum + line.pay } == row.parts.shares
    if (!itemised) return listOf(SharedPart("shares", "Your shares", row.parts.shares))
    return yourLines.map { line ->
        val send = SendRef(line.partyId, line.lootId, line.payeeId)
        SharedPart("${line.lootId}:${line.theirsId}", where.of(line), line.pay, send = send, iconUrl = line.iconUrl)
    }
}

/** One act that came off, as the member reads it. */
private fun paidPart(
    act: Discharge,
    book: SharedBook,
): SharedPart {
    val label =
        when (act.label) {
            "you paid" -> "${book.ownerName} paid you"
            "paid", "offset" -> PAID_LABEL.getValue(act.source)
            else -> act.label
        }
    val written = writtenBy(act, book)
    // Only a typed credit, a receipt or a coupon-money decision: an offset of shares is the owner's act.
    val removable = written?.first == true && (act.source != "DEBT" || act.payouts.isEmpty())
    val by = if (written?.first == false) written.second ?: book.ownerName else null
    return SharedPart(
        act.id,
        label,
        act.amount,
        by,
        if (removable) Removal(REMOVABLE.getValue(act.source), act.id) else null,
    )
}

/** The row an act was recorded as: whether you wrote it, and who did. Null when it is not in the book. */
private fun writtenBy(
    act: Discharge,
    book: SharedBook,
): Pair<Boolean?, String?>? =
    when (act.source) {
        "PAYMENT" -> book.payments.find { it.id == act.id }?.let { it.recordedByYou to it.recordedByName }
        "DEBT" -> book.debts.find { it.id == act.id }?.let { it.recordedByYou to it.recordedByName }
        else -> book.disposals.find { it.id == act.id }?.let { it.recordedByYou to it.recordedByName }
    }

private val PAID_LABEL = mapOf("PAYMENT" to "You paid", "DEBT" to "Offset", "PROCEEDS" to "Coupon sale")
private val REMOVABLE = mapOf("PAYMENT" to "payments", "DEBT" to "debts", "PROCEEDS" to "disposals")

/** Your card in their book, read from your side, or null when the book says nothing about you. */
fun sharedCard(
    book: SharedBook,
    bosses: List<Boss>,
): SharedCard? {
    val key = "person:${book.personId}"
    val row = ownersView(book, bosses).settlement.find { it.key == key } ?: return null
    val receipts = paymentsSinceClosing(book.payments, book.settlements)[key]?.counted ?: emptyList()
    val money = moneyRows(row, receipts)
    val where = Where(book, bosses)
    val sold = SharedPart("sold", "Coupons of ${book.ownerName}'s you kept", row.parts.soldOfYours)
    val owe =
        (yourShares(row, where) + sold + money.typed.filter { it.amount > 0 }.map { enteredPart(it, book) }).filter {
            it.mesos !=
                0.0
        }
    val detail =
        SharedDetail(
            owe = owe,
            oweTotal = owe.fold(0.0) { sum, part -> sum + part.mesos },
            paid = money.discharges.map { paidPart(it, book) },
            paidTotal = money.discharged,
            theyOwe = row.lines.filter { it.direction == "owe" }.map { it.copy(name = where.of(it)) },
            theyOweEntered = money.typed.filter { it.amount < 0 }.map { enteredPart(it, book) },
            holding = row.holding,
        )
    return SharedCard(
        name = book.ownerName,
        image = book.ownerImage,
        personId = book.personId,
        owed = row.owedByYou + row.sharesYouOwe,
        owe = row.mesos,
        holding = row.holding,
        youHold = row.heldByThem,
        youHoldSales = undecidedSales(row.salesHeldByThem, row.heldByThem),
        holdingSales = undecidedSales(row.sales, row.holding),
        piecesOwed = row.piecesYouOwe,
        piecesOwe = row.pieces,
        // Their dollars turned round: what they owe is what you are owed.
        usd = Owings(owe = row.usd.owed, owed = row.usd.owe, net = -row.usd.net),
        detail = detail,
    )
}

/** [totals] with every shared card added in. */
fun withSharedCards(
    totals: SettlementTotals,
    cards: List<SharedCard>,
): SettlementTotals {
    val owed = totals.owed + cards.fold(0.0) { sum, card -> sum + card.owed }
    val owe = totals.owe + cards.fold(0.0) { sum, card -> sum + card.owe }
    val usdOwed = totals.usd.owed + cards.fold(0.0) { sum, card -> sum + card.usd.owed }
    val usdOwe = totals.usd.owe + cards.fold(0.0) { sum, card -> sum + card.usd.owe }
    return SettlementTotals(
        owed,
        owe,
        owed - owe,
        totals.people + cards.size,
        Owings(usdOwe, usdOwed, usdOwed - usdOwe),
    )
}

/** Your pile as the owner's book keeps it, or null when the book holds none of yours. */
fun sharedPile(
    book: SharedBook,
    bosses: List<Boss>,
): SharedPile? {
    val view = ownersView(book, bosses)
    val key = "person:${book.personId}"
    val ledger = view.ledgers.find { holderKey(it.holder) == key } ?: return null
    val theirs = view.ledgers.find { it.holder.kind == SELF }
    val held = theirs?.let { owedByCreditor(it).find { c -> c.key == key }?.pieces } ?: 0.0
    val tranches = LinkedHashMap<String, List<VestigeTranche>>()
    for (tranche in book.tranches) {
        tranches[holderKey(tranche.holder)] =
            (tranches[holderKey(tranche.holder)] ?: emptyList()) + tranche
    }
    val drops =
        ledger.drops.map { drop ->
            drop.copy(transfers = drop.transfers.map { if (it.toId == SELF_KEY) it.copy(to = book.ownerName) else it })
        }
    return SharedPile(
        personId = book.personId,
        ownerName = book.ownerName,
        ledger = ledger.copy(drops = drops, holderName = "You · ${book.ownerName}'s parties"),
        heldOfYours = if (held > 0) mapOf(SELF_KEY to held) else emptyMap(),
        tranches = tranches,
        decided = decidedSales(view.credits, book.disposals),
    )
}
