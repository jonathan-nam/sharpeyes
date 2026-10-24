package com.sharpeyes.money

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

private fun nights(json: JsonElement) = json.jsonArray.map { JsonNight(it.jsonObject) }

private fun JsonArray.sales(i: Int): List<AnsweredSale> = arg(i)

/** A placement keyed back to the sale objects it was keyed by in the TypeScript. */
private fun <V> placement(
    sales: JsonArray,
    placed: Map<Int, V?>,
    value: (V) -> JsonElement,
): JsonElement =
    JsonObject(
        mapOf(
            "\$map" to
                JsonArray(placed.map { (s, v) -> JsonArray(listOf(sales[s], v?.let(value) ?: JsonNull)) }),
        ),
    )

internal val pieceLedgerAdapters: Map<String, Adapter> =
    mapOf(
        "piece-ledger.largestRemainder" to { a -> out(largestRemainder(a.arg(0), a.arg(1))) },
        "piece-ledger.pieces" to { a -> out(pieces(a.arg(0))) },
        "piece-ledger.entitlements" to { a ->
            JsonObject(
                mapOf(
                    "\$map" to
                        JsonArray(
                            entitlements(a.arg(0), a.arg(1)).map { (k, v) ->
                                JsonArray(listOf(JsonPrimitive(k), JsonPrimitive(v)))
                            },
                        ),
                ),
            )
        },
        "piece-ledger.balances" to { a -> out(balances(a.arg(0), a.arg(1))) },
        "piece-ledger.heldOf" to { a -> out(heldOf(a.arg(0))) },
        "piece-ledger.ownShareOf" to { a -> out(ownShareOf(a.arg(0), a.argOrNull(1))) },
        "piece-ledger.transfersOf" to { a -> out(transfersOf(a.arg(0), a.argOrNull(1))) },
        "piece-ledger.spendOldestFirst" to { a -> JsonArray(spendOldestFirst(nights(a[0]), a.arg(1)).map { it.raw }) },
        "piece-ledger.spendSales" to { a -> JsonArray(spendSales(nights(a[0]), a.sales(1)).map { it.raw }) },
        "piece-ledger.placeSalesOnNights" to { a ->
            placement(a[1].jsonArray, placeSalesOnNights(nights(a[0]), a.sales(1))) { list ->
                JsonArray(list.map { JsonObject(mapOf("night" to it.night.raw, "pieces" to JsonPrimitive(it.pieces))) })
            }
        },
        "piece-ledger.placeSales" to { a ->
            placement(a[1].jsonArray, placeSales(nights(a[0]), a.sales(1))) { weeks ->
                JsonObject(
                    mapOf(
                        "\$map" to
                            JsonArray(weeks.map { (k, v) -> JsonArray(listOf(JsonPrimitive(k), JsonPrimitive(v))) }),
                    ),
                )
            }
        },
    )
