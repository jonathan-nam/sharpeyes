package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.system.Refusal
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

/**
 * Puts [partyId] back on the period the app is in, as it stood, or says why it cannot go back.
 *
 * A spent one-off holds nobody while it is off (see validateBossRoster), so somebody in it may have
 * joined another party for this boss since, and two of your parties would run one clear.
 */
internal fun putBackOn(
    partyId: Uuid,
    now: Instant,
): Refusal? {
    val keeper = Party.selectAll().where { Party.id eq partyId }.first()[Party.userId]
    val bossId = bossIdOfParty(partyId)!!
    val oneOff = isOneOff(partyId)
    val roster = rosterNamesFor(partyId, currentWeek())
    val clash = validateBossRoster(keeper, bossId, exclude = partyId, roster, now, oneOff)
    if (clash == null) {
        val period = periodShown(bossResetOf(bossId)!!, week = null, now = now)
        setRunsInPeriod(partyId, oneOff, period, runs = true, now = now)
    }
    return clash
}

/**
 * The standing party deleted from this period that Add Party is asking for again, or null.
 *
 * Your own [held] config for the pair, or a linked account's party this one would duplicate. Either
 * way the answer is that party back, not a second one counting the same night. A one-off on your own
 * is putBackForWeek's instead, which files the night's roster.
 */
internal fun deletedThisPeriod(
    userId: String,
    held: Uuid?,
    characterId: Uuid?,
    bossId: Uuid?,
    request: SavePartyRequest,
    now: Instant,
): Uuid? =
    if (held != null) {
        held.takeIf { !request.oneOff && isSkippedStanding(it, now) }
    } else {
        // Ownership first, as createPartyRoute's: a seat lookup by somebody else's character would
        // bring back a party this account is not in.
        characterId
            ?.takeIf { bossId != null && !request.separate && ownsCharacter(it, userId) }
            ?.let { sharedDuplicateOf(userId, it, bossId!!, request.members) }
            ?.let { Uuid.parse(it.partyId) }
            ?.takeIf { isSkippedStanding(it, now) }
    }

/** [partyId] back on as it stood, as the party it is, or why it cannot go back. */
internal fun bringBack(
    partyId: Uuid,
    userId: String,
    now: Instant,
): Any = putBackOn(partyId, now) ?: findParty(partyId, userId)!!

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
