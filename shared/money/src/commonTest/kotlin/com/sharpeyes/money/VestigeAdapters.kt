package com.sharpeyes.money

import com.sharpeyes.money.coupons.Closures
import com.sharpeyes.money.coupons.LedgerInputs
import com.sharpeyes.money.coupons.alsoHeldByYou
import com.sharpeyes.money.coupons.answeredByHolder
import com.sharpeyes.money.coupons.answeredByPair
import com.sharpeyes.money.coupons.answeredKey
import com.sharpeyes.money.coupons.answeredSalesByPair
import com.sharpeyes.money.coupons.boughtByHolder
import com.sharpeyes.money.coupons.closedByHolder
import com.sharpeyes.money.coupons.foldSeats
import com.sharpeyes.money.coupons.holderFromKey
import com.sharpeyes.money.coupons.holderKey
import com.sharpeyes.money.coupons.holderLedgers
import com.sharpeyes.money.coupons.keptByHolder
import com.sharpeyes.money.coupons.outstanding
import com.sharpeyes.money.coupons.paymentsSinceClosing
import com.sharpeyes.money.coupons.receivedByHolder
import com.sharpeyes.money.coupons.receivedSinceClosing
import com.sharpeyes.money.coupons.saleCredits
import com.sharpeyes.money.coupons.salesByHolder
import com.sharpeyes.money.pieces.AnsweredSale
import com.sharpeyes.money.pieces.heldOfYoursBy
import com.sharpeyes.money.pieces.outstandingOf
import com.sharpeyes.money.pieces.owedByCreditor
import com.sharpeyes.money.pieces.owes
import com.sharpeyes.money.pieces.queueOf
import com.sharpeyes.money.pieces.spendAnswered
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.serializer

/** Argument [i] as a tagged Map, or empty when the call left it off. */
internal inline fun <reified K, reified V> JsonArray.mapArg(i: Int): Map<K, V> =
    getOrNull(i)?.let { moneyJson.decodeFromJsonElement(TaggedMapSerializer(serializer<K>(), serializer<V>()), it) }
        ?: emptyMap()

internal inline fun <reified K, reified V> mapOut(map: Map<K, V>): JsonElement =
    moneyJson.encodeToJsonElement(TaggedMapSerializer(serializer<K>(), serializer<V>()), map)

private val sales: KSerializer<List<AnsweredSale>> = ListSerializer(AnsweredSale.serializer())

internal val vestigeAdapters: Map<String, Adapter> =
    mapOf(
        "vestige-ledger.holderKey" to { a -> out(holderKey(a.arg(0))) },
        "vestige-ledger.holderFromKey" to { a -> out(holderFromKey(a.arg(0))) },
        "vestige-ledger.foldSeats" to { a -> out(foldSeats(a.arg(0))) },
        "vestige-ledger.answeredKey" to { a -> out(answeredKey(a.arg(0), a.arg(1))) },
        "vestige-ledger.salesByHolder" to { a -> mapOut(salesByHolder(a.arg(0))) },
        "vestige-ledger.keptByHolder" to { a -> mapOut(keptByHolder(a.arg(0))) },
        "vestige-ledger.boughtByHolder" to { a -> mapOut(boughtByHolder(a.arg(0))) },
        "vestige-ledger.answeredByHolder" to { a -> mapOut(answeredByHolder(a.arg(0))) },
        "vestige-ledger.answeredSalesByPair" to { a ->
            moneyJson.encodeToJsonElement(
                TaggedMapSerializer(String.serializer(), sales),
                answeredSalesByPair(a.arg(0)),
            )
        },
        "vestige-ledger.saleCredits" to { a -> mapOut(saleCredits(a.arg(0))) },
        "vestige-ledger.receivedByHolder" to { a -> mapOut(receivedByHolder(a.arg(0))) },
        "vestige-ledger.closedByHolder" to { a -> out(closedByHolder(a.arg(0))) },
        "vestige-ledger.paymentsSinceClosing" to { a -> mapOut(paymentsSinceClosing(a.arg(0), a.arg(1))) },
        "vestige-ledger.receivedSinceClosing" to { a -> mapOut(receivedSinceClosing(a.arg(0), a.arg(1))) },
        "vestige-ledger.outstanding" to { a -> out(outstanding(a.arg(0), a.arg(1), a.arg(2), a.mapArg(3))) },
        "vestige-ledger.alsoHeldByYou" to
            { a -> out(alsoHeldByYou(a.arg(0), a.arg(1), a.arg(2), a.mapArg(3), a.arg(4))) },
        "vestige-ledger.holderLedgers" to { a ->
            val pairs =
                a
                    .getOrNull(
                        7,
                    )?.let { moneyJson.decodeFromJsonElement(TaggedMapSerializer(String.serializer(), sales), it) }
            val inputs =
                LedgerInputs(
                    salesByHolder = a.mapArg(1),
                    keptByHolder = a.mapArg(2),
                    boughtByHolder = a.mapArg(3),
                    receivedByHolder = a.mapArg(4),
                    closures = a.argOrNull<Closures>(5) ?: Closures(),
                    answeredByHolder = a.mapArg(6),
                    answeredByPair = pairs ?: emptyMap(),
                )
            out(holderLedgers(a.arg(0), inputs))
        },
    )

internal val ledgerFatesAdapters: Map<String, Adapter> =
    mapOf(
        "ledger-fates.owedByCreditor" to { a -> out(owedByCreditor(a.arg(0), a.mapArg(1))) },
        "ledger-fates.owes" to { a -> out(owes(a.arg(0), a.mapArg(1))) },
        "ledger-fates.heldOfYoursBy" to { a -> mapOut(heldOfYoursBy(a.arg(0))) },
        "ledger-fates.outstandingOf" to { a -> out(outstandingOf(a.arg(0), a.mapArg(1))) },
        "ledger-fates.spendAnswered" to { a -> out(spendAnswered(a.arg(0), a.mapArg(1))) },
        "ledger-fates.queueOf" to { a -> out(queueOf(a.arg(0), a.mapArg(1))) },
    )
