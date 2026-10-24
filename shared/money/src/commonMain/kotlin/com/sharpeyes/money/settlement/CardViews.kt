package com.sharpeyes.money.settlement

import com.sharpeyes.money.TaggedMapSerializer
import com.sharpeyes.money.VestigePayment
import com.sharpeyes.money.VestigeTranche
import com.sharpeyes.money.coupons.CouponSale
import com.sharpeyes.money.coupons.HolderLedger
import com.sharpeyes.money.pieces.FATES
import com.sharpeyes.money.pieces.NightQueue
import com.sharpeyes.money.pieces.OwedRow
import com.sharpeyes.money.pieces.outstandingOf
import com.sharpeyes.money.pieces.owedByCreditor
import com.sharpeyes.money.pieces.queueOf
import com.sharpeyes.money.pieces.roomFor
import com.sharpeyes.money.pieces.stillAsking
import kotlinx.serialization.Serializable

// What one settlement card and one piece-ledger card read from the library, computed once with the
// figures they belong to so no client recomputes them.

/** One act that came off, the shares it named, and its money by the week those fell in. */
@Serializable
data class ActView(
    val act: Discharge,
    val nights: List<OffsetShare>,
    @Serializable(with = TaggedMapSerializer::class)
    val split: Map<String, Double>?,
)

@Serializable
data class CardView(
    val money: MoneyRows,
    val offset: Offset,
    val undecided: List<CouponSale>,
    val theirUndecided: List<CouponSale>,
    val owedByYou: List<PayoutRef>,
    val pair: PairSettlement,
    @Serializable(with = TaggedMapSerializer::class)
    val bosses: Map<CouponSale, List<BossShare>?>,
    @Serializable(with = TaggedMapSerializer::class)
    val nights: Map<CouponSale, List<SaleNight>?>,
    val acts: List<ActView>,
    /** Per week the acts span, newest first: each act cut to that week, or null where it has none. */
    val slices: List<List<ActSlice?>>,
)

@Serializable
data class PileCard(
    /** The tranches still waiting on a decision. */
    val asking: List<String>,
    /** Room for each of FATES, in that order. */
    val room: List<Double>,
    val outstanding: Double,
    val owed: List<OwedRow>,
    val queue: NightQueue,
)

/** A share an offset named whose drop has since been deleted. */
private fun deletedShare(
    lootId: String,
    memberId: String,
) = OffsetShare(
    key = shareKey(lootId, memberId),
    lootId = "",
    memberId = memberId,
    item = "A drop that has been deleted",
    boss = "",
    members = emptyList(),
    on = "",
    weekStart = "",
    share = 0.0,
    currency = "MESO",
    partyId = "",
)

/** Everything one settlement card reads for its row. */
fun cardView(
    row: Settlement,
    receipts: List<VestigePayment>,
    offsetShares: Map<String, OffsetShare>,
): CardView {
    val money = moneyRows(row, receipts)
    val sold = SoldNights(row.sales, row.owedNights)
    val acts =
        money.discharges.map { act ->
            val nights =
                act.payouts.map {
                    offsetShares[shareKey(it.lootId, it.memberId)]
                        ?: deletedShare(it.lootId, it.memberId)
                }
            ActView(act, nights, weekSplit(sold, act, nights))
        }
    val weeks =
        acts
            .flatMap { it.split?.keys ?: emptySet() }
            .distinct()
            .sorted()
            .reversed()
    return CardView(
        money = money,
        offset = offsetOf(row),
        undecided = undecidedSales(row.sales, row.holding),
        theirUndecided = undecidedSales(row.salesHeldByThem, row.heldByThem),
        owedByYou = owedByYouShares(row),
        pair = settleThePair(row),
        bosses = bossesOfSales(sold),
        nights = nightsOfSales(sold),
        acts = acts,
        slices = weeks.map { week -> acts.map { sliceActToWeek(sold, it.act, it.nights, week) } },
    )
}

/** Everything one piece-ledger card reads for its pile. */
fun pileCard(
    ledger: HolderLedger,
    held: Map<String, Double>,
    tranches: List<VestigeTranche>,
    decided: Map<String, Set<String>>,
) = PileCard(
    asking = stillAsking(tranches, decided).map { it.id },
    room = FATES.map { roomFor(ledger, it) },
    outstanding = outstandingOf(ledger, held),
    owed = owedByCreditor(ledger, held),
    queue = queueOf(ledger, held),
)
