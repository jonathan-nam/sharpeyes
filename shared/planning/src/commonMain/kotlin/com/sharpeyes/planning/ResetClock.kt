package com.sharpeyes.planning

import kotlin.math.abs
import kotlin.math.ceil

// The reset clock, ported from frontend/lib/boss-night.ts, which explains it: every time is signed
// minutes against daily reset (00:00 UTC), within the half day either side of it.

private const val HOUR = 60
private const val HALF_DAY = 12 * HOUR
private const val DAY = 24 * HOUR
private const val MS_PER_MINUTE = 60_000L
private const val DECIMAL_GROUP = 4

/** How long a block of the timeline is. The unit a party arranges itself in. */
const val HALF_HOUR = 30

// Matched whole rather than anchored: Java's `$` also matches before a final line terminator.
private val OFFSET = Regex("([+-]?)(\\d{1,2})(?::([0-5]\\d)|\\.(\\d+))?")

/** Minutes as a person would say them: "45m", "1h", "2h 15m". */
fun formatDuration(minutes: Int): String {
    val hours = minutes / HOUR
    val rest = minutes % HOUR
    return when {
        hours == 0 -> "${rest}m"
        rest == 0 -> "${hours}h"
        else -> "${hours}h ${rest}m"
    }
}

/** Into the half day either side of reset. -12:00 is noon UTC's one spelling. */
private fun wrapToReset(minutes: Int): Int = (((minutes + HALF_DAY) % DAY) + DAY) % DAY - HALF_DAY

/** A time against reset as the page draws it: "+3:30", "-0:15". */
fun formatOffset(minutes: Double): String = longForm(wrapToReset(jsRound(minutes).toInt()))

private fun longForm(wrapped: Int): String {
    val size = abs(wrapped)
    return "${sign(wrapped)}${size / HOUR}:${(size % HOUR).toString().padStart(2, '0')}"
}

private fun sign(wrapped: Int) = if (wrapped < 0) "-" else "+"

/** "+4", "+4.5", "-1.5": only where the time IS the half hour, so a short time is never a rounded one. */
fun formatOffsetShort(minutes: Double): String {
    val wrapped = wrapToReset(jsRound(minutes).toInt())
    if (wrapped % HALF_HOUR != 0) return longForm(wrapped)
    val size = abs(wrapped)
    return "${sign(wrapped)}${size / HOUR}${if (size % HOUR == HALF_HOUR) ".5" else ""}"
}

/** "3.5", "+3.5", "3:30", "+3:30" and "-0:30" as minutes against reset. Null when it is not one. */
fun parseOffset(text: String): Int? {
    val match = OFFSET.matchEntire(text.jsTrim()) ?: return null
    val (signText, hoursText, clock) = match.destructured
    val decimal = match.groupValues[DECIMAL_GROUP]
    val rest =
        when {
            clock.isNotEmpty() -> clock.toInt()
            decimal.isNotEmpty() -> jsRound("0.$decimal".toDouble() * HOUR).toInt()
            else -> 0
        }
    // Past twelve either way is refused rather than wrapped, so "+25" is a question and not "+1".
    val size = hoursText.toInt() * HOUR + rest
    return when {
        size > HALF_DAY -> null
        signText == "-" -> -size
        else -> size
    }
}

/** Where now sits against reset, from epoch milliseconds. Quantised to the minute. */
fun offsetNow(at: Long): Int = wrapToReset(at.floorDiv(MS_PER_MINUTE).mod(DAY.toLong()).toInt())

/** The next half hour, which is when a night arranged now would start. Up, never to nearest. */
fun nextHalfHour(offset: Int): Int = ceil(offset / HALF_HOUR.toDouble()).toInt() * HALF_HOUR

/** How long a night from one time to another runs, forwards through reset. Zero past half a day. */
fun spanBetween(
    from: Int,
    to: Int,
): Int {
    val span = to - from
    val forwards = if (span < 0) span + DAY else span
    return if (forwards > HALF_DAY) 0 else forwards
}
