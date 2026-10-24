package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

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

/**
 * Reads a fixture from src/test/resources/money-golden. Strict: a shape that drifted fails here.
 *
 * MONEY_GOLDEN_DIR reads the same files from a directory instead: how an audit runs the port over
 * fixtures recorded from real data, which never belong in the repo.
 */
internal inline fun <reified I, reified O> golden(name: String): GoldenFile<I, O> {
    val text =
        System.getenv("MONEY_GOLDEN_DIR")?.let { java.io.File(it, name).readText() }
            ?: requireNotNull(GoldenCase::class.java.getResourceAsStream("/money-golden/$name")) {
                "no fixture $name: run the frontend's golden tests with UPDATE_GOLDEN=1"
            }.bufferedReader().readText()
    return Json.decodeFromString(text)
}

/**
 * Every case [actual] gets wrong, described. Empty is a port that agrees with the TypeScript on all
 * of them, which is the only bar: a near miss on money is a wrong number.
 */
internal fun <I, O> mismatches(
    file: GoldenFile<I, O>,
    actual: (I) -> O,
): List<String> =
    file.cases.mapIndexedNotNull { index, case ->
        val got = runCatching { actual(case.input) }
        when {
            case.throws && got.isSuccess -> "case $index: expected a refusal, got ${got.getOrNull()} for ${case.input}"
            !case.throws && got.isFailure -> "case $index: refused ${case.input}: ${got.exceptionOrNull()?.message}"
            !case.throws && got.getOrNull() != case.output ->
                "case $index: ${case.input}\n  expected ${case.output}\n  got      ${got.getOrNull()}"
            else -> null
        }
    }

class DropSplitGoldenTest {
    private val file = golden<SplitInput, Split>("drop-split.json")

    @Test
    fun `agrees with the TypeScript on every recorded split`() {
        val wrong = mismatches(file, ::splitDrop)
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} of ${file.cases.size} cases disagree")
    }

    @Test
    fun `the fixture covers refusals and both rounding directions`() {
        // An audit's real data need not contain a refusal.
        if (System.getenv("MONEY_GOLDEN_DIR") != null) return
        assertTrue(file.cases.any { it.throws })
        assertTrue(file.cases.any { it.input.rounding == Rounding.DOWN })
        assertTrue(file.cases.any { it.input.memberShares != null })
    }

    private companion object {
        const val SHOWN = 10
    }
}
