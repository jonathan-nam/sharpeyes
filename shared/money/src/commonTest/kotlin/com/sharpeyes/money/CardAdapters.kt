package com.sharpeyes.money

import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

// Adapters for what the cards and the Drop Log page ask the library directly, as opposed to what one
// module asks another. See money.golden.test.ts, card() and pileCard().

private fun JsonArray.soldNights(i: Int): SoldNights {
    val row = arg<Settlement>(i)
    return SoldNights(row.sales, row.owedNights)
}

private fun <V : Any> byCouponSale(
    values: KSerializer<V>,
    map: Map<CouponSale, V?>,
): JsonElement = moneyJson.encodeToJsonElement(TaggedMapSerializer(CouponSale.serializer(), values.nullable), map)

private fun JsonArray.decided(i: Int): Map<String, Set<String>> =
    getOrNull(i)?.let { moneyJson.decodeFromJsonElement(DecidedSerializer, it) } ?: emptyMap()

private fun JsonArray.closedSet(i: Int): Set<String> =
    moneyJson.decodeFromJsonElement(TaggedSetSerializer(String.serializer()), this[i])

internal val settlementCardAdapters: Map<String, Adapter> =
    mapOf(
        "settlement.offsetOf" to { a -> out(offsetOf(a.arg(0))) },
        "settlement.closingNet" to { a -> out(closingNet(a.arg(0))) },
        "settlement.flipNet" to { a -> out(flipNet(a.arg(0))) },
        "settlement.owedByYouShares" to { a -> out(owedByYouShares(a.arg(0))) },
        "settlement.settleThePair" to { a -> out(settleThePair(a.arg(0))) },
        "settlement.yourPiles" to { a -> out(yourPiles(a.arg(0))) },
        "settlement.splittableDebts" to { a -> out(splittableDebts(a.arg(0), a.mapArg(1))) },
        "settlement.bossesOfSales" to
            { a -> byCouponSale(ListSerializer(BossShare.serializer()), bossesOfSales(a.soldNights(0))) },
        "settlement.nightsOfSales" to
            { a -> byCouponSale(ListSerializer(SaleNight.serializer()), nightsOfSales(a.soldNights(0))) },
        "settlement.weekSplit" to
            { a ->
                weekSplit(a.soldNights(0), a.arg(1), a.arg<List<OffsetShare>>(2))?.let { mapOut(it) }
                    ?: out(null as String?)
            },
        "settlement.sliceActToWeek" to { a -> out(sliceActToWeek(a.soldNights(0), a.arg(1), a.arg(2), a.arg(3))) },
    )

internal val vestigeHelperAdapters: Map<String, Adapter> =
    mapOf(
        "vestige-ledger.holderOf" to { a -> out(holderOf(a.arg(0))) },
        "vestige-ledger.closureKeyOf" to { a -> out(closureKeyOf(a.arg(0), a.arg(1))) },
        "vestige-ledger.ranSeats" to { a -> out(ranSeats(a.arg(0), a.arg(1))) },
        "vestige-ledger.yourShare" to { a -> out(yourShare(a.arg(0), a.arg(1))) },
        "vestige-ledger.couponGapOf" to { a -> out(couponGapOf(a.arg(0), a.arg(1))) },
        "vestige-ledger.couponMoney" to { a -> out(couponMoney(a.arg(0))) },
        "vestige-ledger.runningBalance" to { a -> mapOut(runningBalance(a.arg(0))) },
        "vestige-ledger.stillOpen" to { a -> out(stillOpen(a.arg(0), a.closedSet(1))) },
        "vestige-ledger.unaccounted" to { a -> out(unaccounted(a.arg(0))) },
        "vestige-ledger.unanswered" to { a -> out(unanswered(a.arg(0), a.arg(1), a.arg(2))) },
        "ledger-fates.roomFor" to { a -> out(roomFor(a.arg(0), a.arg(1))) },
        "ledger-fates.stillAsking" to { a -> out(stillAsking(a.arg(0), a.decided(1))) },
        "wallet.isMine" to { a -> out(isMine(a.arg(0))) },
    )
