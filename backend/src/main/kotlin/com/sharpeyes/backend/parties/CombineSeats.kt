package com.sharpeyes.backend.parties

import kotlin.uuid.Uuid

// A character clears a boss once a period, so after a combine nobody may hold two standing parties
// for one boss. Combining a pair settles the two parties it pairs; this settles everybody else, like
// a third character listed in both owners' parties. In memory, over standingParties' rows, so a
// request can be checked whole before anything is written. See CombineProposals.kt.

/** A character two parties would both hold for one boss, and which of those parties hold them. */
internal data class SeatClash(
    val bossId: Uuid,
    val name: String,
    val holders: List<StandingParty>,
) {
    val key get() = bossId to name.lowercase()

    /**
     * The parties that can keep them: every other holder must lose the seat, and a party cannot lose
     * its owner's own character. A character is one account's, which seats it in one party per boss
     * (validateBossRoster), so there is always at least one.
     */
    val options get() = holders.filter { keep -> holders.all { it == keep || it.canLose(name) } }
}

/** Every character held by more than one of [parties] for one boss. */
internal fun clashesIn(parties: List<StandingParty>): List<SeatClash> =
    parties
        .flatMap { party -> party.members.map { Triple(party.bossId, it, party) } }
        .groupBy { (boss, name, _) -> boss to name.lowercase() }
        .values
        .map { seats -> seats.distinctBy { it.third.id } }
        .filter { it.size > 1 }
        .map { seats -> SeatClash(seats.first().first, seats.first().second, seats.map { it.third }) }

/** [parties] with [drops] (party, name) taken out, in memory. */
internal fun withoutSeats(
    parties: List<StandingParty>,
    drops: List<Pair<Uuid, String>>,
): List<StandingParty> =
    parties.map { party ->
        val gone = drops.filter { it.first == party.id }.mapTo(mutableSetOf()) { it.second.lowercase() }
        if (gone.isEmpty()) party else party.copy(members = party.members.filterNot { it.lowercase() in gone })
    }

/** What a combine takes out, and the clashes nobody has answered yet. */
internal data class SeatPlan(
    val drops: List<Pair<Uuid, String>>,
    val open: List<SeatClash>,
)

/**
 * Settles every clash left once [retired] are gone: by [keepIn] (clash key to the party that keeps
 * the character), or on its own where only one party can keep them.
 */
internal fun planSeats(
    standing: List<StandingParty>,
    retired: Set<Uuid>,
    keepIn: Map<Pair<Uuid, String>, Uuid>,
): SeatPlan {
    val drops = mutableListOf<Pair<Uuid, String>>()
    val open = mutableListOf<SeatClash>()
    for (clash in clashesIn(standing.filter { it.id !in retired })) {
        val chosen = keepIn[clash.key]?.takeIf { id -> clash.options.any { it.id == id } }
        val keep = chosen ?: clash.options.singleOrNull()?.id
        if (keep == null) {
            open += clash
        } else {
            clash.holders.filter { it.id != keep }.forEach { drops += it.id to clash.name }
        }
    }
    return SeatPlan(drops, open)
}
