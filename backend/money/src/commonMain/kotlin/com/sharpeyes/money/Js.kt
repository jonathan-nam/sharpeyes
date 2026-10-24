package com.sharpeyes.money

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.math.floor

// What the money port needs to behave as JavaScript does. The TypeScript it was ported from works in
// doubles, rounds with Math.round, orders strings with localeCompare and iterates Maps in insertion
// order; every one of those has a Kotlin near-equivalent that differs at the edges, and a difference
// at the edge is a different meso. See docs/backend-arithmetic-plan.md.

/**
 * JavaScript's Math.round: half towards positive infinity, so -2.5 is -2. Kotlin's round is half to
 * even. Off the fraction rather than `floor(x + 0.5)`, which rounds 0.49999999999999994 up to 1.
 */
internal fun jsRound(x: Double): Double {
    if (x.isNaN() || x.isInfinite()) return x
    val whole = floor(x)
    return if (x - whole >= HALF) whole + 1 else whole
}

private const val HALF = 0.5

/**
 * String.prototype.localeCompare as an en-US browser runs it: ICU collation, signed -1, 0 or 1. Each
 * platform supplies its own; collation.json in the golden fixtures is the test every one must pass.
 */
internal expect fun localeCompare(
    a: String,
    b: String,
): Int

/** A comparator's sign off a difference, as JavaScript's sort reads `b.fraction - a.fraction`. */
internal fun compareNumbers(difference: Double): Int =
    when {
        difference > 0 -> 1
        difference < 0 -> -1
        else -> 0
    }

/**
 * A Map as the frontend's goldenJson writes it: `{"$map": [[key, value], ...]}` in insertion order.
 *
 * The port's own wire format too, because a Map's ORDER is part of what it says (the card list, the
 * queue) and a JSON object does not promise one.
 */
class TaggedMapSerializer<K, V>(
    private val keys: KSerializer<K>,
    private val values: KSerializer<V>,
) : KSerializer<Map<K, V>> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("TaggedMap<${keys.descriptor.serialName},${values.descriptor.serialName}>")

    override fun serialize(
        encoder: Encoder,
        value: Map<K, V>,
    ) {
        val json = (encoder as JsonEncoder).json
        val entries =
            value.entries.map { (k, v) ->
                JsonArray(listOf(json.encodeToJsonElement(keys, k), json.encodeToJsonElement(values, v)))
            }
        encoder.encodeJsonElement(JsonObject(mapOf(MAP to JsonArray(entries))))
    }

    override fun deserialize(decoder: Decoder): Map<K, V> {
        val json = (decoder as JsonDecoder).json
        val entries =
            decoder.decodeJsonElement().jsonObject[MAP]?.jsonArray ?: throw SerializationException("not a \$map")
        val out = LinkedHashMap<K, V>()
        for (entry in entries) {
            val (k, v) = entry.jsonArray
            out[json.decodeFromJsonElement(keys, k)] = json.decodeFromJsonElement(values, v)
        }
        return out
    }

    private companion object {
        const val MAP = "\$map"
    }
}

/** A Set as goldenJson writes it: `{"$set": [...]}` in insertion order. */
class TaggedSetSerializer<T>(
    private val items: KSerializer<T>,
) : KSerializer<Set<T>> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("TaggedSet<${items.descriptor.serialName}>")

    override fun serialize(
        encoder: Encoder,
        value: Set<T>,
    ) {
        val json = (encoder as JsonEncoder).json
        encoder.encodeJsonElement(
            JsonObject(
                mapOf(
                    SET to json.encodeToJsonElement(ListSerializer(items), value.toList()),
                ),
            ),
        )
    }

    override fun deserialize(decoder: Decoder): Set<T> {
        val json = (decoder as JsonDecoder).json
        val list = decoder.decodeJsonElement().jsonObject[SET] ?: throw SerializationException("not a \$set")
        return LinkedHashSet(json.decodeFromJsonElement(ListSerializer(items), list))
    }

    private companion object {
        const val SET = "\$set"
    }
}
