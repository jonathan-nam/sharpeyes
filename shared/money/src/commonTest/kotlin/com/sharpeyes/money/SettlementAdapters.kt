package com.sharpeyes.money

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject

private val answered = TaggedMapSerializer(String.serializer(), ListSerializer(AnsweredSale.serializer()))

/** Argument [i] as a tagged Set of strings, or empty when the call left it off. */
private fun JsonArray.setArg(i: Int): Set<String> =
    getOrNull(i)?.let { moneyJson.decodeFromJsonElement(TaggedSetSerializer(String.serializer()), it) } ?: emptySet()

private fun settlementInputs(a: JsonArray): SettlementInputs {
    val pairs = a.getOrNull(7)?.let { moneyJson.decodeFromJsonElement(answered, it) } ?: emptyMap()
    return SettlementInputs(
        debts = a.argOrNull(2) ?: emptyList(),
        credits = a.mapArg(3),
        received = a.mapArg(4),
        names = a.mapArg(5),
        pinned = a.setArg(6),
        answered = pairs,
        disposals = a.argOrNull(8) ?: emptyList(),
    )
}

internal val settlementAdapters: Map<String, Adapter> =
    mapOf(
        "settlement.buildSettlement" to { a -> out(buildSettlement(a.arg(0), a.arg(1), settlementInputs(a))) },
        "settlement.decidedSales" to { a ->
            val decided = decidedSales(a.mapArg(0), a.arg(1))
            moneyJson.encodeToJsonElement(
                TaggedMapSerializer(String.serializer(), TaggedSetSerializer(String.serializer())),
                decided,
            )
        },
        "settlement.moneyRows" to { a -> out(moneyRows(a.arg(0), a.argOrNull(1) ?: emptyList())) },
        "settlement.settlementTotals" to { a -> out(settlementTotals(a.arg(0))) },
        "settlement.shareKey" to { a -> out(shareKey(a.arg(0), a.arg(1))) },
        "settlement.undecidedSales" to { a ->
            val row = a[0].jsonObject
            val sales: List<CouponSale> = moneyJson.decodeFromJsonElement(row["sales"]!!)
            val holding: Double = moneyJson.decodeFromJsonElement(row["holding"]!!)
            out(undecidedSales(sales, holding))
        },
    )
