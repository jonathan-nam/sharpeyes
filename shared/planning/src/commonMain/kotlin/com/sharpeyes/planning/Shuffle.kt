package com.sharpeyes.planning

import kotlin.math.floor

// Run Order's Shuffle, ported from frontend/lib/boss-run-plan.ts shuffledPlan.

private const val MULBERRY_STEP = 0x6d2b79f5
private const val SHIFT_A = 15
private const val SHIFT_B = 7
private const val SHIFT_C = 14
private const val MIX = 61
private const val UINT_RANGE = 4294967296.0
private const val UINT_MASK = 0xffffffffL

/** `ids` in an order fixed by [seed]: the same seed, the same order, the TypeScript's included. */
fun shuffledIds(
    ids: List<String>,
    seed: Int,
): List<String> {
    // mulberry32, in Int arithmetic, which wraps as JavaScript's `| 0` and Math.imul do.
    var a = seed
    val rand = {
        a += MULBERRY_STEP
        var t = (a xor (a ushr SHIFT_A)) * (1 or a)
        t = (t + (t xor (t ushr SHIFT_B)) * (MIX or t)) xor t
        ((t xor (t ushr SHIFT_C)).toLong() and UINT_MASK) / UINT_RANGE
    }
    val out = ids.toMutableList()
    for (i in out.size - 1 downTo 1) out.swap(i, floor(rand() * (i + 1)).toInt())
    return out
}

/** Runs each person sits out between two of their own, summed. */
private fun waitingOf(plan: Plan): Int {
    val lastAt = HashMap<String, Int>()
    var waiting = 0
    plan.runs.forEachIndexed { at, planned ->
        for (seat in planned.run.seats) {
            lastAt[seat.personId]?.let { waiting += at - it - 1 }
            lastAt[seat.personId] = at
        }
    }
    return waiting
}

private fun partyAt(
    plan: Plan,
    at: Int,
): Int {
    val planned = plan.runs[at]
    return planned.run.seats.size
}

/** planNight's ranking, less its tie-break, on two finished plans of the same length. Zero is a tie. */
fun comparePlans(
    a: Plan,
    b: Plan,
): Int {
    val differs = a.runs.indices.firstOrNull { partyAt(a, it) != partyAt(b, it) }
    return when {
        // Bigger parties earlier, so b's size against a's.
        differs != null -> partyAt(b, differs).compareTo(partyAt(a, differs))
        waitingOf(a) != waitingOf(b) -> waitingOf(a).compareTo(waitingOf(b))
        a.switches != b.switches -> a.switches.compareTo(b.switches)
        else -> a.minutes.compareTo(b.minutes)
    }
}

/**
 * [plan]'s own runs reordered with their ties broken by [seed], for Run Order's Shuffle.
 *
 * Never other bosses, and only an order that scores exactly as well, so a tab's switch count still
 * holds. Where the reordered search ends anywhere else, [plan] comes back as it was.
 */
fun shuffledPlan(
    plan: Plan,
    options: PlanOptions,
    seed: Int,
): Plan {
    val picked = plan.runs.map { it.run }
    val named = options.prefer.orEmpty().toSet()
    val rest = picked.map { it.id }.filterNot { it in named }
    val prefer = options.prefer.orEmpty() + shuffledIds(rest, seed)
    val beamWidth = minOf(options.beamWidth, SHUFFLE_BEAM)
    val mine =
        planNight(
            picked,
            options.copy(prefer = prefer, beamWidth = beamWidth),
        ).byCount.getOrNull(picked.size - 1)
    return if (mine != null && comparePlans(mine, plan) == 0) mine else plan
}

// Narrow, because a press has to answer at once. Measured in frontend/lib/boss-run-plan.ts.
private const val SHUFFLE_BEAM = 200
