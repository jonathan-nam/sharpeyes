package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext

// One route, in a file of its own, as the skip's is. See PartySkipRoute.kt.

/**
 * The config a readable URL names: GET /api/parties/by/rune/lomien.
 *
 * Takes a uuid as its one segment too, which is what an older link carries and what a config whose
 * character shares a name emits. Either way this is the only read the page starts with: it needs the
 * id back before it can ask for the pool, so a slug that names nothing 404s rather than being
 * guessed at. See findPartyBySlug.
 */
internal suspend fun RoutingContext.getPartyBySlug() {
    val (userId, email) = call.principalIdAndEmail()
    val path = call.parameters.getAll("path").orEmpty()
    val party =
        dbQuery {
            ensureUser(userId, email)
            findPartyBySlug(path, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}
