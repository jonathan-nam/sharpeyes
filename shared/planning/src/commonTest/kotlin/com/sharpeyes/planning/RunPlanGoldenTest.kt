package com.sharpeyes.planning

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The shapes frontend/lib/boss-run-plan.golden.test.ts writes. Agreement is exact: a tie broken the
// other way is a different night for the party reading it.

@Serializable
data class NightInput(
    val runs: List<EligibleRun>,
    /** Null is Infinity, which JSON cannot carry. */
    val minutes: Double?,
    val shownMinutes: Double?,
    val available: Map<String, Availability>,
    val prefer: List<String>? = null,
    val beamWidth: Int? = null,
    val seed: Int? = null,
    val hidden: List<String>,
)

@Serializable
data class DescribedRun(
    val id: String,
    val startsAt: Double,
    val switched: List<String>,
    val waitingFor: List<String>,
)

@Serializable
data class DescribedPlan(
    val order: List<DescribedRun>,
    val switches: Int,
    val minutes: Double,
)

@Serializable
data class NightOutput(
    val byCount: List<DescribedPlan>,
    val shown: List<DescribedPlan>,
    val shownFrom: List<Int>,
    val tradeOffs: List<DescribedPlan>,
)

@Serializable
data class ScreenInput(
    val runs: List<CandidateRun>,
    val available: List<String>,
    val everyoneOn: Boolean,
    val everyone: List<String>? = null,
)

@Serializable
data class DescribedRejection(
    val id: String,
    val reason: RejectionReason,
    val detail: List<String>,
)

@Serializable
data class ScreenOutput(
    val eligible: List<String>,
    val rejected: List<DescribedRejection>,
)

@Serializable
data class ShuffleInput(
    val ids: List<String>,
    val seed: Int,
)

private fun Plan.described() =
    DescribedPlan(runs.map { DescribedRun(it.run.id, it.startsAt, it.switched, it.waitingFor) }, switches, minutes)

private fun planned(input: NightInput): NightOutput {
    val options =
        PlanOptions(
            minutes = input.minutes ?: Double.POSITIVE_INFINITY,
            beamWidth = input.beamWidth ?: DEFAULT_BEAM_WIDTH,
            available = input.available,
            prefer = input.prefer,
        )
    val plain = planNight(input.runs, options).byCount
    val byCount = input.seed?.let { seed -> plain.map { shuffledPlan(it, options, seed) } } ?: plain
    val sources =
        sourcesByCount(
            byCount,
            input.hidden.toSet(),
            PlanOptions(minutes = input.shownMinutes ?: Double.POSITIVE_INFINITY, available = input.available),
        )
    val shown = sources.map { it.shown }
    return NightOutput(
        byCount = byCount.map { it.described() },
        shown = shown.map { it.described() },
        shownFrom = sources.map { it.from },
        tradeOffs = tradeOffs(shown).map { it.described() },
    )
}

private fun screened(input: ScreenInput): ScreenOutput {
    val screening = screenRuns(input.runs, input.available, ScreenOptions(input.everyoneOn, input.everyone))
    return ScreenOutput(
        screening.eligible.map { it.id },
        screening.rejected.map { DescribedRejection(it.run.id, it.reason, it.detail) },
    )
}

class RunPlanGoldenTest {
    @Test
    fun `plans every recorded night as the TypeScript does`() {
        val file = golden<NightInput, NightOutput>("run-plan.json")
        val wrong = mismatches(file, ::planned)
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} of ${file.cases.size} nights disagree")
    }

    @Test
    fun `the nights cover shuffles, prefers, windows, hidden runs and narrow beams`() {
        val inputs = golden<NightInput, NightOutput>("run-plan.json").cases.map { it.input }
        assertTrue(inputs.any { it.seed != null })
        assertTrue(inputs.any { it.prefer != null })
        assertTrue(inputs.any { it.available.isNotEmpty() })
        assertTrue(inputs.any { it.hidden.isNotEmpty() })
        assertTrue(inputs.any { it.beamWidth != null })
        assertTrue(inputs.any { it.minutes == null })
    }

    @Test
    fun `screens every recorded set of runs as the TypeScript does`() {
        val file = golden<ScreenInput, ScreenOutput>("run-screen.json")
        val wrong = mismatches(file, ::screened)
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} of ${file.cases.size} screenings disagree")
        val reasons =
            file.cases
                .flatMap { case ->
                    case.output
                        ?.rejected
                        .orEmpty()
                        .map { it.reason }
                }.toSet()
        assertEquals(RejectionReason.entries.toSet(), reasons)
    }

    @Test
    fun `shuffles ids exactly as the TypeScript does`() {
        val file = golden<ShuffleInput, List<String>>("shuffled-ids.json")
        val wrong = mismatches(file) { shuffledIds(it.ids, it.seed) }
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} of ${file.cases.size} shuffles disagree")
    }

    private companion object {
        const val SHOWN = 5
    }
}
