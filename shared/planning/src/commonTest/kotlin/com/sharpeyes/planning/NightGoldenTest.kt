package com.sharpeyes.planning

import com.sharpeyes.api.bosses.BossResponse
import com.sharpeyes.api.parties.PartyResponse
import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals

// The shapes frontend/lib/boss-night.golden.test.ts writes.

private val BOSSES =
    listOf("lotus", "lucid", "chosen-seren", "malefic-star", "will").mapIndexed { i, key ->
        BossResponse(bossKey = key, name = "Boss $i", reset = "WEEKLY", difficulties = listOf("NORMAL", "HARD"))
    }

@Serializable
data class RosterInput(
    val parties: List<PartyResponse>,
    val people: List<String>? = null,
    val ticked: List<String>,
)

@Serializable
data class RosterOutput(
    val rosterFrom: List<NightPerson>,
    val rosterOfSwitchers: List<NightPerson>,
    val runs: List<CandidateRun>,
    val stillToRun: List<String>,
)

@Serializable
data class ClockInput(
    val minutes: Double,
    val text: String,
    val from: Int,
    val to: Int,
    val at: Long,
)

@Serializable
data class ClockOutput(
    val formatOffset: String,
    val formatOffsetShort: String,
    val formatDuration: String,
    val nextHalfHour: Int,
    val parseOffset: Int?,
    val spanBetween: Int,
    val offsetNow: Int,
)

@Serializable
data class TextInput(
    val plan: Plan,
    val roster: List<NightPerson>,
    val startAt: Int,
    val only: List<String>? = null,
)

@Serializable
data class DescribedGridRow(
    val id: String,
    val cells: List<GridCell>,
)

@Serializable
data class DescribedGrid(
    val people: List<NightPerson>,
    val rows: List<DescribedGridRow>,
)

@Serializable
data class TextOutput(
    val times: List<RunTime>,
    val ticks: List<String?>,
    val grid: DescribedGrid,
    val text: String,
)

@Serializable
data class SearchInput(
    val inputs: NightInputs,
    val parties: List<PartyResponse>,
    val answered: List<String>,
)

@Serializable
data class SearchedRun(
    val id: String,
    val startsAt: Double,
    val switched: List<String>,
)

@Serializable
data class SearchedPlan(
    val order: List<SearchedRun>,
    val switches: Int,
    val minutes: Double,
)

@Serializable
data class SearchOutput(
    val plannedParties: List<String>,
    val hidden: List<String>,
    val onTonight: List<NightPerson>,
    val searched: List<String>,
    /** Null is Infinity. */
    val night: Double?,
    val available: Map<String, Availability>,
    val allRuns: List<CandidateRun>,
    val hereAll: List<String>,
    val minutes: Double?,
    val byCount: List<SearchedPlan>,
)

private fun rostered(input: RosterInput) =
    RosterOutput(
        rosterFrom = rosterFrom(input.parties),
        rosterOfSwitchers = rosterOfSwitchers(input.parties),
        runs = runsFromParties(input.parties, BOSSES, input.people?.toSet()),
        stillToRun = stillToRun(input.parties, input.ticked.toSet()).map { it.id },
    )

private fun clocked(input: ClockInput): ClockOutput {
    val whole = jsRound(input.minutes).toInt()
    return ClockOutput(
        formatOffset = formatOffset(input.minutes),
        formatOffsetShort = formatOffsetShort(input.minutes),
        formatDuration = formatDuration(kotlin.math.abs(whole)),
        nextHalfHour = nextHalfHour(whole),
        parseOffset = parseOffset(input.text),
        spanBetween = spanBetween(input.from, input.to),
        offsetNow = offsetNow(input.at),
    )
}

private fun texted(input: TextInput): TextOutput {
    val times = runTimes(input.plan, input.roster, input.startAt)
    val grid = planGrid(input.plan.runs, input.roster)
    return TextOutput(
        times = times,
        ticks = runTicks(times),
        grid = DescribedGrid(grid.people, grid.rows.map { DescribedGridRow(it.planned.run.id, it.cells) }),
        text = planAsText(input.plan, input.roster, input.only?.toSet()),
    )
}

private fun Double.orNull() = takeIf { it.isFinite() }

private fun searched(input: SearchInput): SearchOutput {
    val switchers = rosterOfSwitchers(input.parties).map { it.id }.toSet()
    val night = nightOf(input.inputs, NightData(input.parties, input.answered.toSet(), BOSSES, switchers))
    val result = searchNight(night.search)
    val search = night.search
    return SearchOutput(
        plannedParties = night.plannedParties.map { it.id },
        hidden = night.hidden.toList(),
        onTonight = night.onTonight,
        searched = search.searched.map { it.id },
        night = search.night.orNull(),
        available = search.available,
        allRuns = search.allRuns,
        hereAll = search.hereAll,
        minutes = result.minutes.orNull(),
        byCount = result.byCount.map(::searchedPlan),
    )
}

private fun searchedPlan(plan: Plan) =
    SearchedPlan(plan.runs.map { SearchedRun(it.run.id, it.startsAt, it.switched) }, plan.switches, plan.minutes)

class NightGoldenTest {
    private fun <I, O> agrees(
        file: GoldenFile<I, O>,
        actual: (I) -> O,
    ) {
        val wrong = mismatches(file, actual)
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} of ${file.cases.size} cases disagree")
    }

    @Test
    fun `builds rosters and runs from parties as the TypeScript does`() =
        agrees(golden<RosterInput, RosterOutput>("night-roster.json"), ::rostered)

    @Test
    fun `reads and writes the reset clock as the TypeScript does`() =
        agrees(golden<ClockInput, ClockOutput>("reset-clock.json"), ::clocked)

    @Test
    fun `times, grids and pastes a plan as the TypeScript does`() =
        agrees(golden<TextInput, TextOutput>("night-text.json"), ::texted)

    @Test
    fun `turns the controls into a searched night as the TypeScript does`() =
        agrees(golden<SearchInput, SearchOutput>("night-search.json"), ::searched)

    private companion object {
        const val SHOWN = 5
    }
}
