package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.parseWeekParam
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.plugins.failing
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.sprites.SpriteCache
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// A config is one of your characters, on one boss, with the people that character runs it with.
// The character and the boss are what it IS, so they are set once, at create.

fun Route.partyRoutes(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    get { listParties() }
    post { createPartyRoute(nexonLookupService, spriteCache) }
    // Before /{id}, and matched ahead of it whatever the order: Ktor scores a constant segment
    // above a parameter. Every pool at once, for the wallet, and the wallet's one settle back.
    get("/loot") { listAllLoot() }
    // A drop logged by character and boss rather than by pool, for the Drop Log. See logDropRoute.
    post("/loot") { logDropRoute() }
    post("/loot/settle") { settleRoute() }
    // A pile of one interchangeable drop, priced in one go across every pool it sits in. See
    // lotSaleRoute.
    post("/loot/lot") { lotSaleRoute() }
    // Which mode a boss run alone is run at, by character and boss. Constant, so ahead of /{id}.
    put("/solo") { setSoloDifficultyRoute() }
    // A config by its readable name rather than its id. Constant first segment, so it is matched
    // ahead of /{id} and no character name can shadow a route. See PartySlug.kt.
    get("/by/{path...}") { getPartyBySlug() }
    get("/{id}") { getParty() }
    put("/{id}") { savePartyRoute(nexonLookupService, spriteCache) }
    put("/{id}/roster") { saveWeekRosterRoute(nexonLookupService, spriteCache) }
    put("/{id}/clear") { setClearRoute() }
    put("/{id}/skip") { setSkipRoute() }
    delete("/{id}") { deletePartyRoute() }
    route("/{id}/loot") { lootRoutes() }
}

/**
 * Every config, for the current week by default or one past week with `?week=YYYY-MM-DD`.
 *
 * The week does not change which configs come back. It changes the pool counts each one carries,
 * which is what lets Party View's drop badges answer for the same week as the ticks beside them.
 * See lootCountsFor for what a week admits.
 *
 * `?solo=include` adds the pools for bosses run alone. Off by default: they are not parties, and a
 * caller that draws a roster or plans a night would be showing a party of one.
 *
 * `?retired=include` adds the configs taken off the lists whose pools were kept. Off by default.
 * Every caller that reads the loot rows against the configs it was given asks for it, which is the
 * wallet, the Drop Log and both party pages: without it a retired party's drops go missing from one
 * and unreadable in the other, and a coupon debt that cancels against one of its nights is billed
 * again. A page may still DRAW only the standing ones. See drop-log-callers.test.ts.
 */
private suspend fun RoutingContext.listParties() {
    val (userId, email) = call.principalIdAndEmail()
    val week =
        parseWeekParam(call.request.queryParameters["week"]).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }
    val includeSolo = call.request.queryParameters["solo"] == "include"
    val includeRetired = call.request.queryParameters["retired"] == "include"
    val parties =
        transaction {
            ensureUser(userId, email)
            partiesFor(userId, week, includeSolo, includeRetired)
        }
    call.respond(parties)
}

/**
 * Every party's pool, in one request.
 *
 * The wallet nets what you owe against what you are owed, so it needs all of them at once, and one
 * request per party would be one per boss per character. No money is computed here: the split has
 * one implementation (frontend/lib/drop-split.ts) and this ships the drops it reads.
 */
private suspend fun RoutingContext.listAllLoot() {
    val (userId, email) = call.principalIdAndEmail()
    val pools =
        transaction {
            ensureUser(userId, email)
            allLootFor(userId)
        }
    call.respond(pools)
}

private suspend fun RoutingContext.getParty() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val party =
        transaction {
            ensureUser(userId, email)
            findParty(partyId, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}

/**
 * Makes the config, or takes over the one already holding this pair's slot.
 *
 * A config can sit in that slot without being a party anybody set up: logging a drop on a boss
 * nobody else was there for opens a solo one (see createSoloParty), a retired one is kept for its
 * pool, and a one-off is a night rather than an arrangement. None is a second config for the pair,
 * so each is filled in rather than refused and the drops already pooled stay where they are. Which,
 * and when, is takesOverConfig.
 *
 * A one-off run again in a later period is armed for that period rather than duplicated, which is
 * what keeps idx_party_character_boss and partyIdFor answering with one config.
 */
private suspend fun RoutingContext.createPartyRoute(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePartyRequest>()
    val sprites = lookUpSprites(userId, request.members, email, nexonLookupService, spriteCache)

    val outcome =
        transaction {
            val now = Clock.System.now()
            val characterId = Uuid.parseOrNull(request.characterId)
            val bossId = bossIdForKey(request.bossKey)
            // Ownership first, so a characterId that is not this user's cannot reach a config
            // through the pair lookup, which does not filter by user.
            val held =
                if (characterId == null || bossId == null || !ownsCharacter(characterId, userId)) {
                    null
                } else {
                    partyIdFor(characterId, bossId)
                }
            val takeOver = held?.takeIf { takesOverConfig(it, request, now) }
            if (takeOver != null) {
                // The request's kind, not the row's: takeOverParty writes request.oneOff over it.
                validateSavedPartyRules(takeOver, request)
                    ?: applyRoster(
                        RosterTarget(
                            request,
                            bossIdOfParty(takeOver),
                            characterIdOfParty(takeOver),
                            exclude = takeOver,
                            oneOff = request.oneOff,
                            context = SeatContext(userId, sprites, now),
                        ),
                    ) {
                        takeOverParty(userId, takeOver, request, now, sprites)
                        findParty(takeOver, userId)!!
                    }
            } else {
                validateNewPartyRules(request, userId, characterId, bossId)
                    ?: applyRoster(
                        RosterTarget(
                            request,
                            bossId,
                            characterId,
                            exclude = null,
                            oneOff = request.oneOff,
                            context = SeatContext(userId, sprites, now),
                        ),
                    ) {
                        val id = createParty(userId, characterId!!, bossId!!, request, now, sprites)
                        findParty(id, userId)!!
                    }
            }
        }
    respondToSave(outcome, HttpStatusCode.Created)
}

private suspend fun RoutingContext.savePartyRoute(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SavePartyRequest>()
    val sprites = lookUpSprites(userId, request.members, email, nexonLookupService, spriteCache)

    val outcome =
        transaction {
            val now = Clock.System.now()
            // The row's kind, not the request's: oneOff is read at create only, so an edit leaves
            // it as it was. See writeSavedParty for the order the rules are asked in.
            writeSavedParty(userId, partyId, request, now, sprites)
        }
    respondToSave(outcome, HttpStatusCode.OK)
}

/**
 * Says who ran a week, or puts that week back to the usual party.
 *
 * This week unless one is named, and a named past week has to be one nothing was paid out of. A
 * payout was pinned when its drop sold and is never re-derived, so rewriting who ran behind one
 * leaves the roster and the money owed disagreeing, with nothing on screen to say which is right.
 * A week whose drops are all still in the pool has no such row to contradict, and refusing it meant
 * a Wednesday night could not be answered for on Thursday morning: the reset had moved it out of
 * reach an hour after it was run.
 *
 * Never a week that has not happened. There is nothing to record about it, and the roster it would
 * pin is one the party would otherwise have reverted to on its own.
 *
 * The party's own roster is untouched: that is what PUT /{id} is for.
 */
private suspend fun RoutingContext.saveWeekRosterRoute(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SaveWeekRosterRequest>()
    val asked =
        parseWeekParam(request.week).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }
    val sprites = lookUpSprites(userId, request.members.orEmpty(), email, nexonLookupService, spriteCache)

    val outcome =
        transaction {
            ensureUser(userId, email)
            val characterId = characterIdOfParty(partyId)
            val thisWeek = currentWeek()
            // Omitted means this week. Which week THIS is comes from the server's clock rather than
            // the payload, so a browser a day out cannot file a roster in the neighbouring week.
            val week = asked ?: thisWeek
            val problem =
                validateRosterWeek(partyId, week, thisWeek)
                    ?: request.members?.let { members ->
                        validateMembers(members)
                            ?: bossIdOfParty(partyId)?.let { boss ->
                                validateWeekRoster(
                                    userId,
                                    boss,
                                    exclude = partyId,
                                    week,
                                    rosterOf(characterId, members),
                                )
                            }
                    }
            when {
                !ownsParty(partyId, userId) || characterId == null -> null
                problem != null -> problem
                else -> {
                    val now = Clock.System.now()
                    // A pool opened for a boss run alone has no seats to name, so saying somebody
                    // ran that week is also saying it is not a solo config. Done here rather than
                    // by a POST first, because the two must not come apart: adopting through
                    // POST /api/parties writes the names as the STANDING roster, and every later
                    // week nobody answers for would then claim those same people ran. See
                    // openSoloParty.
                    if (!request.members.isNullOrEmpty() && isSoloParty(partyId)) {
                        openSoloParty(partyId, week, now)
                    }
                    saveWeekRoster(partyId, characterId, week, request.members, SeatContext(userId, sprites, now))
                    findParty(partyId, userId)!!
                }
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
}

/**
 * Ticks this config's boss cleared for the current period, or un-ticks it.
 *
 * The same row the clear matrix reads, so the two pages cannot disagree, and the same row the next
 * planner capture will overwrite.
 */
private suspend fun RoutingContext.setClearRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SetClearRequest>()

    val party =
        transaction {
            ensureUser(userId, email)
            val found = findParty(partyId, userId)
            if (found != null) {
                val boss =
                    BossCatalog
                        .selectAll()
                        .where { BossCatalog.bossKey eq found.bossKey }
                        .first()
                setPartyClear(found, boss[BossCatalog.id], boss[BossCatalog.reset], request.cleared, Clock.System.now())
            }
            if (found == null) null else findParty(partyId, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}

private suspend fun RoutingContext.deletePartyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return

    // A pool is kept rather than refused over: the config retires instead of being deleted, and its
    // drops stay in the wallet and the Drop Log. See retireOrDeleteParty. Both answers are 204,
    // because both mean the same thing to the caller: it is off the list.
    val outcome =
        transaction {
            ensureUser(userId, email)
            retireOrDeleteParty(partyId, userId, Clock.System.now())
        }
    if (outcome == Removal.NOT_FOUND) {
        call.respond(HttpStatusCode.NotFound)
    } else {
        call.respond(HttpStatusCode.NoContent)
    }
}

internal suspend fun RoutingContext.respondToSave(
    outcome: Any?,
    onSuccess: HttpStatusCode,
) {
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> {
            // The refusal is the whole content of this response, so the log has to carry it too.
            // Without it a refused save is a bare "FAIL PUT /api/parties/:id 400", which says a
            // roster was rejected and not which name or which other party.
            call.failing(outcome)
            call.respond(HttpStatusCode.BadRequest, outcome)
        }
        // Not a 400. The request is writable and the screen is being asked one question about it,
        // so the client has a second call to make rather than an input to fix.
        is RosterConflictResponse -> {
            call.failing(outcome.message)
            call.respond(HttpStatusCode.Conflict, outcome)
        }
        is PartyResponse -> call.respond(onSuccess, outcome)
        else -> call.respond(HttpStatusCode.InternalServerError)
    }
}
