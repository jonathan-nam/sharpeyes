package com.sharpeyes.planning

// What Run Order does to a finished search, ported from frontend/lib/boss-run-plan.ts.

/**
 * [plan] with the [hidden] runs taken out, the rest kept in the same order and re-timed.
 *
 * How Run Order hides what is already cleared: the best order of a subset is not the superset's order
 * with gaps. Switch marks are redrawn against the rows kept, and a run that no longer fits is dropped.
 */
fun withoutRuns(
    plan: Plan,
    hidden: Set<String>,
    options: PlanOptions,
): Plan {
    val runs = mutableListOf<PlannedRun>()
    var clock = 0.0
    var switches = 0
    val parked = HashMap<String, String>()
    for (planned in plan.runs.filterNot { it.run.id in hidden }) {
        val window = windowOf(planned.run, options.available)
        val startsAt = if (window.readyAt > clock) window.readyAt else clock
        val ends = startsAt + planned.run.minutes
        if (ends <= options.minutes && ends <= window.dueBy) {
            val switched = parkAll(parked, planned.run.seats)
            val waitingFor = if (startsAt > clock) window.waitsFor else emptyList()
            runs += planned.copy(switched = switched, startsAt = startsAt, waitingFor = waitingFor)
            clock = ends
            switches += switched.size
        }
    }
    return Plan(runs, switches, clock)
}

/** Parks every seat on its character, returning who that switched, in seat order. */
private fun parkAll(
    parked: MutableMap<String, String>,
    seats: List<AttributedSeat>,
): List<String> =
    seats.mapNotNull { seat ->
        val wasOn = parked.put(seat.personId, seat.character)
        seat.personId.takeIf { wasOn != null && wasOn != seat.character }
    }

/**
 * [byCount] with the [hidden] runs taken out of every plan, one plan per length, shortest first. Of
 * two that come out the same length, the one from the longer search is kept.
 */
fun withoutRunsByCount(
    byCount: List<Plan>,
    hidden: Set<String>,
    options: PlanOptions,
): List<Plan> {
    val byLength = LinkedHashMap<Int, Plan>()
    for (plan in byCount.asReversed()) {
        val kept = withoutRuns(plan, hidden, options)
        if (kept.runs.isNotEmpty() && kept.runs.size !in byLength) byLength[kept.runs.size] = kept
    }
    return byLength.values.sortedBy { it.runs.size }
}

/**
 * The plans worth choosing between, longest first: a shorter plan earns its place only by costing
 * strictly fewer switches than every longer one.
 */
fun tradeOffs(byCount: List<Plan>): List<Plan> {
    val worthwhile = mutableListOf<Plan>()
    var fewest = Int.MAX_VALUE
    for (plan in byCount.asReversed()) {
        if (plan.switches < fewest) {
            worthwhile += plan
            fewest = plan.switches
        }
    }
    return worthwhile
}
