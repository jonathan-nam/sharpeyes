package com.sharpeyes.planning

import com.sharpeyes.api.bosses.bossLabel
import kotlinx.serialization.Serializable
import kotlin.math.floor

// A plan as the page and the paste say it: each run's time, the half-hour rules, the grid with a column
// per person, and the fenced table. Ported from frontend/lib/boss-night.ts, which explains each.

/** Where one run sits on the reset clock. */
@Serializable
data class RunTime(
    /** "+2:30". */
    val at: String,
    /** The same time in minutes against reset. */
    val startsAt: Double,
    /** Reached by adding up a duration nobody timed, so the time is a guess too. */
    val approx: Boolean,
    /** Who the night is waiting for to start this one. Usually nobody. */
    val waitingFor: List<NightPerson>,
)

/** Every run's place on the clock. A wait clears the guess: the night lands on a time somebody said. */
fun runTimes(
    plan: Plan,
    roster: List<NightPerson>,
    startAt: Int,
): List<RunTime> {
    val personAt = roster.associateBy { it.id }
    var guessed = false
    return plan.runs.map { planned ->
        if (planned.waitingFor.isNotEmpty()) guessed = false
        val startsAt = startAt + planned.startsAt
        val time = RunTime(formatOffset(startsAt), startsAt, guessed, planned.waitingFor.mapNotNull { personAt[it] })
        if (planned.run.assumed) guessed = true
        time
    }
}

/** The half-hour rule that opens above each run, or null where the run sits under the one above. */
fun runTicks(times: List<RunTime>): List<String?> {
    var open: Double? = null
    return times.map { time ->
        val block = floor(time.startsAt / HALF_HOUR) * HALF_HOUR
        if (block == open) {
            null
        } else {
            open = block
            "${if (time.approx) "~" else ""}${formatOffsetShort(block)}"
        }
    }
}

/** One person's place in one run: the character they bring, or null when they sit it out. */
@Serializable
data class GridCell(
    val character: String?,
    val switched: Boolean,
)

@Serializable
data class GridRow(
    val planned: PlannedRun,
    val cells: List<GridCell>,
)

@Serializable
data class PlanGrid(
    val people: List<NightPerson>,
    val rows: List<GridRow>,
)

/** The night with a column per person, for only the people the plan uses. */
fun planGrid(
    runs: List<PlannedRun>,
    roster: List<NightPerson>,
): PlanGrid {
    val inPlan = runs.flatMap { planned -> planned.run.seats.map { it.personId } }.toSet()
    val people = roster.filter { it.id in inPlan }
    val rows =
        runs.map { planned ->
            val switched = planned.switched.toSet()
            GridRow(
                planned,
                people.map { person ->
                    val seat = planned.run.seats.find { it.personId == person.id }
                    GridCell(seat?.character, seat != null && person.id in switched)
                },
            )
        }
    return PlanGrid(people, rows)
}

/**
 * What a party calls a boss out loud, where that is not its name. frontend/lib/boss-art.ts holds the
 * same four, and the night-text goldens fail when the two differ.
 */
val BOSS_SHORT_NAMES =
    mapOf(
        "chosen-seren" to "Seren",
        "kalos-the-guardian" to "Kalos",
        "first-adversary" to "Adversary",
        "malefic-star" to "Star",
    )

// ASCII on purpose: a glyph in a code fence is a monospace font's guess at how wide it is.
private const val SITTING_OUT = "X"
private const val SWITCH_MARK = "*"
private const val COLUMN_GAP = "  "
private val BREAKS = Regex("[\t\n\r]+")

private fun bossHeading(planned: PlannedRun): String =
    bossLabel(BOSS_SHORT_NAMES[planned.run.bossKey] ?: planned.run.bossName, planned.run.difficulty)

/** A field with nothing in it that can break a row. */
private fun cell(value: String): String = value.replace(BREAKS, " ").jsTrim()

/** Rows of fields, each column padded to its own widest cell and flush left within it. */
private fun paddedTable(rows: List<List<String>>): List<String> {
    val widths = rows.first().indices.map { i -> rows.maxOf { (it.getOrNull(i) ?: "").length } }
    return rows.map { row ->
        row.mapIndexed { i, field -> field.padEnd(widths.getOrElse(i) { 0 }) }.joinToString(COLUMN_GAP).jsTrimEnd()
    }
}

/**
 * The plan as a fenced table for pasting where the party talks: bosses down, people across, an X
 * where somebody sits one out. [only] draws just those runs, for part of a night.
 */
fun planAsText(
    plan: Plan,
    roster: List<NightPerson>,
    only: Set<String>? = null,
): String {
    val runs = if (only == null) plan.runs else plan.runs.filter { it.run.id in only }
    if (runs.isEmpty()) return "No bosses fit in the time."

    val grid = planGrid(runs, roster)
    val header = listOf("") + grid.people.map { cell(it.name) }
    val body =
        grid.rows.map { row ->
            listOf(cell(bossHeading(row.planned))) +
                row.cells.map { c ->
                    if (c.character == null) SITTING_OUT else cell(c.character + if (c.switched) SWITCH_MARK else "")
                }
        }
    return (listOf("```") + paddedTable(listOf(header) + body) + listOf("```")).joinToString("\n")
}
