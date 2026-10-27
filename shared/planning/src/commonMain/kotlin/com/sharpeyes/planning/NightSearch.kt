package com.sharpeyes.planning

import com.sharpeyes.api.bosses.BossResponse
import com.sharpeyes.api.parties.PartyResponse
import kotlinx.serialization.Serializable

// Run Order's night, from the controls to the search's answer. Ported from frontend/lib/night-search.ts.

/** One person's window, as typed. Parsed where it is used, so a half-finished "+3" is not a time. */
@Serializable
data class WindowText(
    val from: String,
    val until: String,
)

/** The controls a night is planned from. Minutes are against reset, as parseOffset reads them. */
@Serializable
data class NightInputs(
    val budget: Int,
    val openOnly: Boolean,
    val everyoneOn: Boolean,
    val away: List<String>,
    val startAt: Int,
    val windows: Map<String, WindowText>,
    val timed: Boolean,
)

/** The account's side of a night: what does not come from the controls. */
data class NightData(
    val running: List<PartyResponse>,
    val answered: Set<String>,
    val bosses: List<BossResponse>,
    val switchers: Set<String>,
)

/** Everything the search reads. */
data class NightSearchInput(
    val searched: List<EligibleRun>,
    val hidden: List<String>,
    /** Minutes the night may take, infinite when it is not run to the clock. */
    val night: Double,
    val available: Map<String, Availability>,
    val everyoneOn: Boolean,
    val allRuns: List<CandidateRun>,
    val hereAll: List<String>,
)

data class NightResult(
    /** What the search was given, the hidden runs' minutes included. Shuffle searches with it. */
    val minutes: Double,
    val byCount: List<Plan>,
)

data class Night(
    val plannedParties: List<PartyResponse>,
    /** Planned and then hidden: the configs already cleared. See withoutRuns. */
    val hidden: Set<String>,
    /** Who is on, in grid order. */
    val onTonight: List<NightPerson>,
    val search: NightSearchInput,
)

/** The night [inputs] describe, over [data]. */
fun nightOf(
    inputs: NightInputs,
    data: NightData,
): Night {
    val running = data.running
    val plannedParties = if (inputs.openOnly) stillToRun(running, data.answered) else running

    // Every config on the period is planned, cleared or not, and the cleared ones hidden after.
    val shownIds = plannedParties.map { it.id }.toSet()
    val hidden = running.map { it.id }.filterNot { it in shownIds }.toCollection(LinkedHashSet())
    val allRuns = runsFromParties(running, data.bosses, data.switchers)

    val on = { person: NightPerson -> person.id in data.switchers && person.id !in inputs.away }
    val onTonight = rosterFrom(plannedParties).filter(on)
    // Everyone in a hidden run too, or their runs would be refused and drop out of the search.
    val hereAll = rosterFrom(running).filter(on).map { it.id }
    val screening = ScreenOptions(everyoneOn = inputs.everyoneOn, everyone = onTonight.map { it.id })
    val search =
        NightSearchInput(
            searched = screenRuns(allRuns, hereAll, screening).eligible,
            hidden = hidden.toList(),
            night = if (inputs.timed) inputs.budget.toDouble() else Double.POSITIVE_INFINITY,
            available = availableOf(inputs, data.switchers),
            everyoneOn = inputs.everyoneOn,
            allRuns = allRuns,
            hereAll = hereAll,
        )
    return Night(plannedParties, hidden, onTonight, search)
}

/** The windows, moved from the reset clock to minutes from the start of the night. None untimed. */
private fun availableOf(
    inputs: NightInputs,
    switchers: Set<String>,
): Map<String, Availability> {
    if (!inputs.timed) return emptyMap()
    val byPerson = LinkedHashMap<String, Availability>()
    for ((id, window) in inputs.windows) {
        if (id !in switchers) continue
        val from = parseOffset(window.from)?.let { spanBetween(inputs.startAt, it).toDouble() }
        val until = parseOffset(window.until)?.let { spanBetween(inputs.startAt, it).toDouble() }
        if (from != null || until != null) byPerson[id] = Availability(from, until)
    }
    return byPerson
}

/** The search itself: the slow part, and the part the web runs in a worker. */
fun searchNight(search: NightSearchInput): NightResult {
    val hidden = search.hidden.toSet()
    // The hidden runs take no time tonight, so the search gets their minutes back on top.
    val minutes = search.night + search.searched.filter { it.id in hidden }.sumOf { it.minutes }
    val prefer = if (search.everyoneOn) preferredOrder(search, hidden) else null
    val byCount =
        planNight(
            search.searched,
            PlanOptions(minutes, available = search.available, prefer = prefer),
        ).byCount
    return NightResult(minutes, byCount)
}

/** The night's order without "Exclude Party Member Subsets", for that toggle to break ties toward. */
private fun preferredOrder(
    search: NightSearchInput,
    hidden: Set<String>,
): List<String> {
    val runs = screenRuns(search.allRuns, search.hereAll).eligible
    val minutes = search.night + runs.filter { it.id in hidden }.sumOf { it.minutes }
    return planNight(runs, PlanOptions(minutes, available = search.available)).best.runs.map { it.run.id }
}
