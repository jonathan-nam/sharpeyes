package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.db.Party
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Add Party on a boss whose STANDING party was taken off this period. The pair has one config
// (idx_party_character_boss), so a one-off cannot be made beside it, and taking it over would
// write the night's roster and difficulty over the standing ones. Instead the config goes back on
// this period with the night's names as this week's roster, which is what the week roster route
// already means by "somebody else ran it this week". The difficulty is this period's too, so the
// config's own mode is back next period. See PartyWeekDifficulty.kt.

/** True when this is a standing party, not a solo pool, that is off the period the app is in now. */
internal fun isSkippedStanding(
    partyId: Uuid,
    now: Instant,
): Boolean {
    val row =
        Party
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
    val standing = row != null && !row[Party.oneOff] && row[Party.standing] && !row[Party.solo]
    val reset = row?.takeIf { standing }?.let { bossResetOf(it[Party.bossCatalogId]) }
    return reset != null && !runsInPeriod(partyId, oneOff = false, periodShown(reset, week = null, now = now))
}

/** Why this night cannot be filed as the skipped party's week, or null. */
internal fun validatePutBack(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
): Any? {
    val row = Party.selectAll().where { Party.id eq partyId }.first()
    return validateDifficulty(row[Party.bossCatalogId], request.difficulty)
        ?: validateMembers(request.members)
        ?: validateWeekRoster(
            userId,
            row[Party.bossCatalogId],
            exclude = partyId,
            currentWeek(),
            rosterOf(row[Party.characterId], request.members),
        )
}

/** Puts the party back on this period at the request's difficulty, its names as this week's roster. */
internal fun putBackForWeek(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?>,
) {
    val period = periodShown(bossResetOf(bossIdOfParty(partyId)!!)!!, week = null, now = now)
    // Ahead of the two writes below, which re-file this period's pieces at the mode it ran at.
    setPeriodDifficulty(partyId, period, request.difficulty)
    setRunsInPeriod(partyId, oneOff = false, period, runs = true, now = now)
    saveWeekRoster(
        partyId,
        characterIdOfParty(partyId)!!,
        currentWeek(),
        request.members,
        SeatContext(userId, sprites, now),
    )
}
