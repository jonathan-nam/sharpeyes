package com.sharpeyes.money

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Replays what frontend/lib/money.golden.test.ts recorded at each module boundary. See
// docs/backend-arithmetic-plan.md. One adapter per function: decode its arguments, call the port,
// encode what it returned. Compared as JSON, numbers by value and an absent field the same as null,
// which is how the TypeScript's own readers treat them.

/** A recorded call, as goldenJson wrote it. */
internal class Call(
    val args: JsonArray,
    val result: JsonElement?,
    val throws: Boolean,
)

/** Every recorded call of one module, by `module.function`, one file per function. */
internal fun moduleCalls(module: String): Map<String, List<Call>> =
    goldenFixtures("module-$module.")
        .flatMap { file ->
            moneyJson.parseToJsonElement(file.text()).jsonObject.map { (fn, calls) ->
                fn to
                    calls.jsonArray.map {
                        val call = it.jsonObject
                        Call(
                            call["args"]!!.jsonArray,
                            call["result"],
                            call["throws"]?.jsonPrimitive?.booleanOrNull == true,
                        )
                    }
            }
        }.toMap()

internal typealias Adapter = (JsonArray) -> JsonElement

/** Argument [i], decoded. Null when the call left it off, so the port's default applies. */
internal inline fun <reified T> JsonArray.arg(i: Int): T = moneyJson.decodeFromJsonElement(this[i])

internal inline fun <reified T> JsonArray.argOrNull(i: Int): T? =
    getOrNull(i)?.takeIf { it !is JsonNull }?.let { moneyJson.decodeFromJsonElement<T>(it) }

internal inline fun <reified T> out(value: T): JsonElement = moneyJson.encodeToJsonElement(value)

/**
 * Every disagreement between what the TypeScript returned and what [adapters] return, described.
 * A function with no adapter is reported too, so a recorded boundary cannot go unchecked by omission.
 */
internal fun disagreements(
    calls: Map<String, List<Call>>,
    adapters: Map<String, Adapter>,
): List<String> =
    calls.flatMap { (fn, list) ->
        val adapter = adapters[fn] ?: return@flatMap listOf("$fn: no adapter for ${list.size} recorded calls")
        list.mapIndexedNotNull { i, call ->
            val got = runCatching { adapter(call.args) }
            when {
                call.throws && got.isSuccess -> "$fn #$i: expected a refusal"
                !call.throws && got.isFailure -> "$fn #$i: threw ${got.exceptionOrNull()}"
                !call.throws && !jsonMatches(call.result, got.getOrThrow()) ->
                    "$fn #$i:\n  args     ${call.args.toString().take(
                        LIMIT,
                    )}\n  expected ${call.result.toString().take(LIMIT)}\n" +
                        "  got      ${got.getOrThrow().toString().take(LIMIT)}"
                else -> null
            }
        }
    }

private const val LIMIT = 600

/** JSON equality the way the port promises it. See the file comment. */
internal fun jsonMatches(
    expected: JsonElement?,
    actual: JsonElement?,
): Boolean {
    val e = expected ?: JsonNull
    val a = actual ?: JsonNull
    return when {
        e is JsonNull || a is JsonNull -> e is JsonNull && a is JsonNull
        e is JsonPrimitive && a is JsonPrimitive -> primitivesMatch(e, a)
        e is JsonArray && a is JsonArray -> e.size == a.size && e.indices.all { jsonMatches(e[it], a[it]) }
        e is JsonObject && a is JsonObject -> (e.keys + a.keys).all { jsonMatches(e[it], a[it]) }
        else -> false
    }
}

/** Where [actual] first departs from [expected], as a path and both values, or null when they match. */
internal fun firstDifference(
    expected: JsonElement?,
    actual: JsonElement?,
    path: String = "$",
): String? {
    val e = expected ?: JsonNull
    val a = actual ?: JsonNull
    return when {
        e is JsonArray && a is JsonArray && e.size == a.size ->
            e.indices.firstNotNullOfOrNull { firstDifference(e[it], a[it], "$path[$it]") }
        e is JsonObject && a is JsonObject ->
            (e.keys + a.keys).firstNotNullOfOrNull { firstDifference(e[it], a[it], "$path.$it") }
        jsonMatches(e, a) -> null
        else -> "$path expected ${e.toString().take(LIMIT)} got ${a.toString().take(LIMIT)}"
    }
}

private fun primitivesMatch(
    e: JsonPrimitive,
    a: JsonPrimitive,
): Boolean {
    if (e.isString || a.isString) return e.isString && a.isString && e.content == a.content
    val en = e.doubleOrNull
    val an = a.doubleOrNull
    return if (en != null && an != null) en == an else e.content == a.content
}
