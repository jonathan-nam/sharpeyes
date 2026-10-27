package com.sharpeyes.planning

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** One fixture's text by [name], or null when there is none. Each target reads files its own way. */
internal expect fun goldenFixture(name: String): String?

/** One recorded answer of the TypeScript: what it returned, or that it refused. See frontend/lib/golden.ts. */
@Serializable
data class GoldenCase<I, O>(
    val input: I,
    val output: O? = null,
    val throws: Boolean = false,
)

@Serializable
data class GoldenFile<I, O>(
    val generatedBy: String,
    val cases: List<GoldenCase<I, O>>,
)

/** Reads a fixture from the planning-golden resources. Strict: a shape that drifted fails here. */
internal inline fun <reified I, reified O> golden(name: String): GoldenFile<I, O> {
    val text =
        requireNotNull(goldenFixture(name)) {
            "no fixture $name: run the frontend's golden tests with UPDATE_GOLDEN=1"
        }
    return Json.decodeFromString(text)
}

/** Every case [actual] gets wrong, described. Empty is a port that agrees on all of them. */
internal fun <I, O> mismatches(
    file: GoldenFile<I, O>,
    actual: (I) -> O,
): List<String> =
    file.cases.mapIndexedNotNull { index, case ->
        val got = runCatching { actual(case.input) }
        when {
            case.throws && got.isSuccess -> "case $index: expected a refusal, got ${got.getOrNull()}"
            !case.throws && got.isFailure -> "case $index: refused: ${got.exceptionOrNull()?.message}"
            !case.throws && got.getOrNull() != case.output ->
                "case $index:\n  expected ${case.output}\n  got      ${got.getOrNull()}"
            else -> null
        }
    }
