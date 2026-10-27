package com.sharpeyes.planning

import kotlinx.serialization.Serializable

/** When one person can play, in minutes from the start of the night. An end left out is open. */
@Serializable
data class Availability(
    val from: Double? = null,
    /** When they have to be FINISHED, not when they can last start something. */
    val until: Double? = null,
)

data class PlanOptions(
    /** The window, in minutes. Infinite for a night not run to the clock. */
    val minutes: Double,
    /** How many partial plans stay alive per step. Wider is slower and no worse. */
    val beamWidth: Int = DEFAULT_BEAM_WIDTH,
    /** By person id. Anybody not in here is free for the whole night. */
    val available: Map<String, Availability> = emptyMap(),
    /** Run ids in the order another plan put them, to break ties toward. Null breaks them on run id. */
    val prefer: List<String>? = null,
)

const val DEFAULT_BEAM_WIDTH = 1000

@Serializable
data class PlannedRun(
    val run: EligibleRun,
    /** Who changed character to start this run, in seat order. */
    val switched: List<String>,
    /** Minutes from the start of the night. */
    val startsAt: Double,
    /** Who the plan is waiting for, when this run starts later than the one before it finished. */
    val waitingFor: List<String>,
)

@Serializable
data class Plan(
    val runs: List<PlannedRun>,
    val switches: Int,
    /** Minutes from the start of the night to the end of the last run, waiting included. */
    val minutes: Double,
)

val EMPTY_PLAN = Plan(emptyList(), 0, 0.0)

/** The best plan, and the best plan of every length from 1 up. */
@Serializable
data class NightPlans(
    val best: Plan,
    val byCount: List<Plan>,
)

/** When a run can start and when it has to be finished: the tightest window of its seats. */
internal class RunWindow(
    val readyAt: Double,
    val dueBy: Double,
    /** Who a wait would be for, named only where the run is actually held up. */
    val waitsFor: List<String>,
)

internal fun windowOf(
    run: EligibleRun,
    available: Map<String, Availability>,
): RunWindow {
    var readyAt = 0.0
    var dueBy = Double.POSITIVE_INFINITY
    for (seat in run.seats) {
        val window = available[seat.personId] ?: continue
        window.from?.let { if (it > readyAt) readyAt = it }
        window.until?.let { if (it < dueBy) dueBy = it }
    }
    val waitsFor =
        if (readyAt > 0) {
            run.seats.filter { available[it.personId]?.from == readyAt }.map { it.personId }
        } else {
            emptyList()
        }
    return RunWindow(readyAt, dueBy, waitsFor)
}
