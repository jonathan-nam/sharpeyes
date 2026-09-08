package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.parseWeekParam
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlin.time.Clock

// One route, in a file of its own, as the drop log's is. See LootLogRoute.kt.

/** The config went with the night. A success with no party to answer with, not a 404. */
private object Gone

/**
 * Takes this boss off the period, or puts it back, leaving a STANDING config where it is.
 *
 * A week off is not the party ending. Saying it by deleting the config would take the seats and the
 * pool with it and need retyping next Thursday, which is why the mark is a row of its own and why
 * going back to the config's default is that row's deletion.
 *
 * A ONE-OFF is the other way round, because it is a night rather than an arrangement: taking it off
 * is the night not happening, so its drops for the period go with it and the config follows once
 * nothing points at it. See retractNight, which holds the whole rule.
 *
 * One route for both kinds of config, because the question is the same one. What differs is which
 * way the default runs: a standing party is on until this says otherwise, a one-off is off until it
 * does. setRunsInPeriod picks the table.
 *
 * This period only, the same rule the week roster keeps: a past period's pool was settled against
 * what actually happened, and re-answering "did you run it" afterwards would leave the two
 * disagreeing with nothing on screen saying which is right.
 *
 * The period is the boss's own, not the Thursday week, so a Black Mage taken off is off the month.
 */
internal suspend fun RoutingContext.setSkipRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SetPartySkipRequest>()
    val asked =
        parseWeekParam(request.week).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val now = Clock.System.now()
            val bossId = bossIdOfParty(partyId)
            val reset = bossId?.let(::bossResetOf)
            when {
                !ownsParty(partyId, userId) || bossId == null || reset == null -> null
                // Omitted means this week, which is also the only one allowed. Taken from the
                // server's clock rather than the payload, so a browser a day out cannot take a boss
                // off the neighbouring week.
                asked != null && asked != currentWeek() -> "only this week can be changed"
                else -> {
                    // A spent one-off holds nobody while it is off (see validateBossRoster), so
                    // somebody in it may have joined another party for this boss since. Putting it
                    // back on is the only door into that pair that does not write a config, so the
                    // rule is kept here too rather than let two of your parties run one clear.
                    val oneOff = isOneOff(partyId)
                    val clash =
                        if (request.skipped) {
                            null
                        } else {
                            validateBossRoster(
                                userId,
                                bossId,
                                exclude = partyId,
                                rosterNamesFor(partyId, currentWeek()),
                                now,
                                oneOff,
                            )
                        }
                    if (clash != null) {
                        clash
                    } else {
                        val period = periodShown(reset, week = null, now = now)
                        setRunsInPeriod(partyId, oneOff, period, runs = !request.skipped, now = now)
                        if (oneOff && request.skipped && retractNight(partyId, reset, period)) {
                            Gone
                        } else {
                            findParty(partyId, userId)
                        }
                    }
                }
            }
        }
    // Ahead of respondToSave, which reads every non-party as a failure and would answer a config
    // that is gone because it worked with the 404 that means it was never there.
    if (outcome === Gone) {
        call.respond(HttpStatusCode.NoContent)
    } else {
        respondToSave(outcome, HttpStatusCode.OK)
    }
}
