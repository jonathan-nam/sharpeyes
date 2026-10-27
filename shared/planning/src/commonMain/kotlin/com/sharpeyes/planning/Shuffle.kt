package com.sharpeyes.planning

import kotlin.math.floor

// Run Order's Shuffle, ported from frontend/lib/boss-run-plan.ts shuffledNight.

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
 * planNight with its ties broken by [seed] instead of by run id.
 *
 * The tie-break also decides which states the beam keeps, so both searches run and the shuffled plan
 * is kept at each length only where it scores at least as well. A `prefer` still comes first.
 */
fun shuffledNight(
    runs: List<EligibleRun>,
    options: PlanOptions,
    seed: Int,
): NightPlans {
    val plain = planNight(runs, options)
    val named = options.prefer.orEmpty().toSet()
    val rest = runs.map { it.id }.filterNot { it in named }
    val shuffled = planNight(runs, options.copy(prefer = options.prefer.orEmpty() + shuffledIds(rest, seed)))

    val byCount =
        (0 until maxOf(plain.byCount.size, shuffled.byCount.size)).map { i ->
            val mine = shuffled.byCount.getOrNull(i)
            val theirs = plain.byCount.getOrNull(i)
            when {
                mine == null -> requireNotNull(theirs)
                theirs == null || comparePlans(mine, theirs) <= 0 -> mine
                else -> theirs
            }
        }
    return NightPlans(byCount.lastOrNull() ?: EMPTY_PLAN, byCount)
}
