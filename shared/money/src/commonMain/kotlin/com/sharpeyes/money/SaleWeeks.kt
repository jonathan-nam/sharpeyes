package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.floor

// Which bossing week an act's money came from, and which nights a coupon sale came off. The port of
// weekSplit and its siblings in frontend/lib/settlement.ts. A sale is placed by the same newest-first
// spend that draws the nights it answered, so a row cannot name a night the card did not spend.

/** Anything with a week and a share in it: an offset's resolved shares. */
interface WeekShare {
    val weekStart: String
    val share: Double
}

@Serializable
data class BossShare(
    val bossKey: String? = null,
    val partyId: String,
    val pieces: Double,
)

/** One night a coupon sale came off, and how many of its coupons. */
@Serializable
data class SaleNight(
    val night: HeldOfYours,
    val pieces: Double,
)

/** One act as it reads under a single bossing week. */
@Serializable
data class ActSlice(
    val act: Discharge,
    val shares: List<OffsetShare>,
    @Serializable(with = TaggedMapSerializer::class)
    val bosses: Map<CouponSale, List<BossShare>>,
    @Serializable(with = TaggedMapSerializer::class)
    val saleNights: Map<CouponSale, List<SaleNight>>,
)

/** The card's coupon sales and the nights they were spent over. */
data class SoldNights(
    val sales: List<CouponSale>,
    val owedNights: List<HeldOfYours>,
) {
    private val wrapped = sales.map { AnsweredSale(it.pieces, it.soldAt ?: "") }

    /** Each sale's nights, in the order the sales were spent, or null where they cannot cover it. */
    fun placed(): Map<CouponSale, List<SaleNight>?> =
        placeSalesOnNights(owedNights, wrapped).entries.associateTo(LinkedHashMap()) { (i, taken) ->
            sales[i] to taken?.map { SaleNight(it.night, it.pieces) }
        }
}

/** A sale's money over the weeks its pieces came from, by pieces, the odd meso on the latest week. */
private fun mesosByWeek(
    sale: CouponSale,
    pieces: Map<String, Double>,
): Map<String, Double> {
    val ordered = pieces.entries.sortedWith { a, b -> localeCompare(a.key, b.key) }
    val out = LinkedHashMap<String, Double>()
    var left = sale.mesos
    ordered.forEachIndexed { i, (week, p) ->
        val part = if (i == ordered.size - 1) left else floor((sale.mesos * p) / sale.pieces)
        left -= part
        out[week] = part
    }
    return out
}

private fun piecesByWeek(taken: List<SaleNight>): Map<String, Double> {
    val weeks = LinkedHashMap<String, Double>()
    for ((night, pieces) in taken) weeks[night.weekStart] = (weeks[night.weekStart] ?: 0.0) + pieces
    return weeks
}

/** Each night's pieces folded by boss and party, biggest first. */
private fun bossesOf(taken: List<SaleNight>): List<BossShare> {
    val by = LinkedHashMap<String, BossShare>()
    for ((night, pieces) in taken) {
        val key = "${night.bossKey}:${night.partyId}"
        val seen = by[key]
        by[key] = seen?.copy(pieces = seen.pieces + pieces) ?: BossShare(night.bossKey, night.partyId, pieces)
    }
    return by.values.sortedWith { a, b -> compareNumbers(b.pieces - a.pieces) }
}

/** An offset's money by the weeks its shares fell in, or null where no week can be told. */
private fun shareWeeks(
    act: Discharge,
    shares: List<WeekShare>,
): Map<String, Double>? {
    val weeks = shares.map { it.weekStart }.distinct()
    val total = shares.fold(0.0) { sum, n -> sum + n.share }
    return when {
        shares.any { it.weekStart == "" } -> null
        weeks.size == 1 -> linkedMapOf(weeks.single() to act.amount)
        total != act.amount -> null
        else ->
            LinkedHashMap<String, Double>().apply {
                for (n in shares) {
                    this[n.weekStart] =
                        (this[n.weekStart] ?: 0.0) + n.share
                }
            }
    }
}

/** What one act discharged, by the week the drops behind it fell in. Null where no week can be told. */
fun weekSplit(
    row: SoldNights,
    act: Discharge,
    shares: List<WeekShare>,
): Map<String, Double>? {
    if (act.payouts.isNotEmpty()) return shareWeeks(act, shares)
    val placed = row.placed()
    val nights = act.sales.map { placed[it] }
    val unplaceable = act.sales.isEmpty() || nights.any { it == null }
    return if (unplaceable) null else salesByWeek(act.sales, nights.map { it!! })
}

/** Each sale's money over the weeks its nights fell in, summed across the sales. */
private fun salesByWeek(
    sales: List<CouponSale>,
    nights: List<List<SaleNight>>,
): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    sales.forEachIndexed { i, sale ->
        for ((week, part) in mesosByWeek(sale, piecesByWeek(nights[i]))) out[week] = (out[week] ?: 0.0) + part
    }
    return out
}

/** The bosses each coupon sale came off, biggest first, or null where the nights cannot cover it. */
fun bossesOfSales(row: SoldNights): Map<CouponSale, List<BossShare>?> =
    row.placed().mapValuesTo(LinkedHashMap()) { (_, taken) -> taken?.let(::bossesOf) }

/** The nights each coupon sale came off, or null where the nights cannot cover it. */
fun nightsOfSales(row: SoldNights): Map<CouponSale, List<SaleNight>?> = row.placed()

/** One act as it reads under a single week: only that week's sales and nights. Null where it has no week. */
fun sliceActToWeek(
    row: SoldNights,
    act: Discharge,
    held: List<OffsetShare>,
    week: String,
): ActSlice? {
    val amount = weekSplit(row, act, held)?.get(week)
    return when {
        amount == null -> null
        act.payouts.isNotEmpty() -> {
            val payouts = act.payouts.filterIndexed { i, _ -> held.getOrNull(i)?.weekStart == week }
            val inWeek = held.filter { it.weekStart == week }
            ActSlice(act.copy(amount = amount, payouts = payouts), inWeek, emptyMap(), emptyMap())
        }
        else -> salesSlice(row, act.copy(amount = amount), held, week)
    }
}

/** A coupon-sale act cut to one week: each sale's part of that week, its nights and its bosses. */
private fun salesSlice(
    row: SoldNights,
    act: Discharge,
    held: List<OffsetShare>,
    week: String,
): ActSlice {
    val placed = row.placed()
    val sales = mutableListOf<CouponSale>()
    val bosses = LinkedHashMap<CouponSale, List<BossShare>>()
    val saleNights = LinkedHashMap<CouponSale, List<SaleNight>>()
    // Every sale of an act weekSplit could place is placed, so each lookup here succeeds.
    for (sale in act.sales) {
        val taken = placed.getValue(sale)!!
        val weekPieces = piecesByWeek(taken)
        val pieces = weekPieces[week]?.takeIf { it != 0.0 } ?: continue
        val slice = sale.copy(pieces = pieces, mesos = mesosByWeek(sale, weekPieces).getValue(week))
        val inWeek = taken.filter { it.night.weekStart == week }
        sales += slice
        saleNights[slice] = inWeek
        bosses[slice] = bossesOf(inWeek)
    }
    return ActSlice(act.copy(sales = sales), held, bosses, saleNights)
}
