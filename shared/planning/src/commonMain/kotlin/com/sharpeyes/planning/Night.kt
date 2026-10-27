package com.sharpeyes.planning

import com.sharpeyes.api.bosses.BossResponse
import com.sharpeyes.api.parties.PartyMemberResponse
import com.sharpeyes.api.parties.PartyResponse
import kotlinx.serialization.Serializable

// Turning the account's party configs into a night the planner can order. Ported from
// frontend/lib/boss-night.ts, which explains the rules.

/** You, as a person the schedule keeps on one character. Every real person id is a UUID. */
const val YOU = "you"

/** The run time assumed for a config nobody has timed. frontend/lib/boss-minutes.ts DEFAULT_MINUTES. */
const val DEFAULT_MINUTES = 30

@Serializable
data class NightPerson(
    val id: String,
    val name: String,
)

/** Whose character a seat is, or null when nobody has said. `characterId` is proof it is yours. */
fun ownerOf(member: PartyMemberResponse): String? = if (member.characterId != null) YOU else member.personId

/** Everyone who could be on tonight, you first and the rest by name. */
fun rosterFrom(parties: List<PartyResponse>): List<NightPerson> {
    val others = LinkedHashMap<String, String>()
    var includesYou = false
    for (member in parties.flatMap { it.members }) {
        when (val owner = ownerOf(member)) {
            YOU -> includesYou = true
            null -> Unit
            else -> others[owner] = member.personName ?: member.name
        }
    }
    val sorted = others.map { (id, name) -> NightPerson(id, name) }.sortedWith { a, b -> localeCompare(a.name, b.name) }
    return if (includesYou) listOf(NightPerson(YOU, "You")) + sorted else sorted
}

/** The roster minus anybody with only one character on these configs. Run Order plans for these alone. */
fun rosterOfSwitchers(parties: List<PartyResponse>): List<NightPerson> {
    val characters = HashMap<String, MutableSet<String>>()
    for (member in parties.flatMap { it.members }) {
        val owner = ownerOf(member) ?: continue
        characters.getOrPut(owner) { HashSet() } += member.name
    }
    return rosterFrom(parties).filter { (characters[it.id]?.size ?: 0) > 1 }
}

/** The mode a config ran at in the week shown, where that was not its usual one. */
fun modeThisWeek(party: PartyResponse): String? = party.weekDifficulty ?: party.difficulty

/**
 * Your configs as candidate runs. A config with a seat nobody plays, or one played by somebody
 * outside [people] when it is given, is not a run.
 */
fun runsFromParties(
    parties: List<PartyResponse>,
    bosses: List<BossResponse>,
    people: Set<String>? = null,
): List<CandidateRun> {
    val nameFor = bosses.associate { it.bossKey to it.name }

    fun counts(member: PartyMemberResponse): Boolean {
        val owner = ownerOf(member)
        return owner != null && (people == null || owner in people)
    }
    return parties
        .filter { party -> party.members.isNotEmpty() && party.members.all(::counts) }
        .map { party ->
            CandidateRun(
                id = party.id,
                bossKey = party.bossKey,
                bossName = nameFor[party.bossKey] ?: party.bossKey,
                difficulty = modeThisWeek(party),
                minutes = (party.minutes ?: DEFAULT_MINUTES).toDouble(),
                assumed = party.minutes == null,
                seats = party.members.map { RunSeat(it.name, ownerOf(it)) },
            )
        }
}

/** The configs still to run, keeping the ones ticked off from this page. */
fun stillToRun(
    parties: List<PartyResponse>,
    tickedHere: Set<String>,
): List<PartyResponse> = parties.filter { it.cleared != true || it.id in tickedHere }
