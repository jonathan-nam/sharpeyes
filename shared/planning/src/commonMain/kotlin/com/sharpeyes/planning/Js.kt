package com.sharpeyes.planning

import kotlin.math.floor

// What the port needs to behave as JavaScript does where Kotlin's near-equivalent differs at the edge.

/** JavaScript's Math.round: half towards positive infinity, so -2.5 is -2. Kotlin's round is half to even. */
internal fun jsRound(x: Double): Double {
    if (x.isNaN() || x.isInfinite()) return x
    val whole = floor(x)
    return if (x - whole >= HALF) whole + 1 else whole
}

private const val HALF = 0.5

// String.prototype.trim's set: WhiteSpace (tab, vertical tab, form feed, the byte order mark, every Zs)
// and LineTerminator. Kotlin's isWhitespace differs both ways: it leaves the byte order mark and takes
// U+001C to U+001F, which JavaScript keeps.
// Escaped for the regex rather than the compiler: ktlintFormat rewrote "\u" escapes into the
// invisible characters themselves and lost the byte order mark doing it.
private val JS_SPACE =
    Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A" + "\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]")

private fun Char.isJsSpace(): Boolean = JS_SPACE.matches(toString())

internal fun String.jsTrim(): String = trim { it.isJsSpace() }

internal fun String.jsTrimEnd(): String = trimEnd { it.isJsSpace() }
