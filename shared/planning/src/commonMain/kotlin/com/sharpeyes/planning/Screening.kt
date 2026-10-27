package com.sharpeyes.planning

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Which of tonight's runs can be scheduled at all. Ported from frontend/lib/boss-run-plan.ts, which
// holds the reasoning; the goldens in commonTest hold the two to the same answers.

/** One seat in a run: a character, and whose it is. Null means nobody has claimed it. */
@Serializable
data class RunSeat(
    val character: String,
    val personId: String?,
)

/** A boss somebody could run tonight, with the party that would run it. */
@Serializable
data class CandidateRun(
    val id: String,
    val bossKey: String,
    val bossName: String,
    /** The mode the config says it runs. Null for a hand-typed run. */
    val difficulty: String?,
    /** Door to door, in minutes. */
    val minutes: Double,
    /** The minutes are the flat fallback, nobody having timed this party. */
    val assumed: Boolean = false,
    val seats: List<RunSeat>,
)

/** A seat whose owner is known. Every seat of an eligible run has one. */
@Serializable
data class AttributedSeat(
    val character: String,
    val personId: String,
)

/** A candidate that survived screening, so it can actually be scheduled. */
@Serializable
data class EligibleRun(
    val id: String,
    val bossKey: String,
    val bossName: String,
    val difficulty: String?,
    val minutes: Double,
    val assumed: Boolean = false,
    val seats: List<AttributedSeat>,
)

@Serializable
enum class RejectionReason {
    @SerialName("person-twice")
    PERSON_TWICE,

    @SerialName("person-unavailable")
    PERSON_UNAVAILABLE,

    @SerialName("unattributed-seat")
    UNATTRIBUTED_SEAT,

    @SerialName("leaves-somebody-out")
    LEAVES_SOMEBODY_OUT,
}

@Serializable
data class Rejection(
    val run: CandidateRun,
    val reason: RejectionReason,
    val detail: List<String>,
)

@Serializable
data class Screening(
    val eligible: List<EligibleRun>,
    val rejected: List<Rejection>,
)

/**
 * [everyoneOn] keeps only the runs that seat everybody in [everyone], which is everybody available
 * when it is null.
 */
data class ScreenOptions(
    val everyoneOn: Boolean = false,
    val everyone: Iterable<String>? = null,
)

/** The candidates that can run tonight, and why the others cannot. */
fun screenRuns(
    runs: List<CandidateRun>,
    availablePersonIds: Iterable<String>,
    options: ScreenOptions = ScreenOptions(),
): Screening {
    val available = availablePersonIds.toSet()
    val everyone = options.everyone?.toSet() ?: available
    val eligible = mutableListOf<EligibleRun>()
    val rejected = mutableListOf<Rejection>()
    for (run in runs) {
        val rejection = rejectionOf(run, available, everyone.takeIf { options.everyoneOn })
        if (rejection != null) rejected += rejection else eligible += run.attributed()
    }
    return Screening(eligible, rejected)
}

/** The first reason [run] cannot be scheduled, in the order the TypeScript checks them. */
private fun rejectionOf(
    run: CandidateRun,
    available: Set<String>,
    everyone: Set<String>?,
): Rejection? {
    val seenPersons = LinkedHashMap<String, MutableList<String>>()
    for (seat in run.seats) {
        val person = seat.personId ?: continue
        seenPersons.getOrPut(person) { mutableListOf() } += seat.character
    }
    val doubled = seenPersons.values.filter { it.size > 1 }.flatten()
    val unattributed = run.seats.filter { it.personId == null }.map { it.character }
    val missing = run.seats.mapNotNull { it.personId }.filterNot { it in available }
    val seated = run.seats.mapNotNull { it.personId }.toSet()
    val out = everyone?.filterNot { it in seated }.orEmpty()
    return when {
        doubled.isNotEmpty() -> Rejection(run, RejectionReason.PERSON_TWICE, doubled)
        unattributed.isNotEmpty() -> Rejection(run, RejectionReason.UNATTRIBUTED_SEAT, unattributed)
        missing.isNotEmpty() -> Rejection(run, RejectionReason.PERSON_UNAVAILABLE, missing)
        out.isNotEmpty() -> Rejection(run, RejectionReason.LEAVES_SOMEBODY_OUT, out)
        else -> null
    }
}

private fun CandidateRun.attributed(): EligibleRun =
    EligibleRun(
        id = id,
        bossKey = bossKey,
        bossName = bossName,
        difficulty = difficulty,
        minutes = minutes,
        assumed = assumed,
        seats = seats.map { AttributedSeat(it.character, requireNotNull(it.personId)) },
    )
