package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SetAutoVestigesRequest
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

/** PUT /api/parties/{id}/auto-vestiges. The owner or a joined member, as for the clear itself. */
internal suspend fun RoutingContext.setAutoVestigesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SetAutoVestigesRequest>()
    val party =
        dbQuery {
            ensureUser(userId, email)
            if (!canEditParty(partyId, userId)) return@dbQuery null
            setAutoAddVestiges(partyId, request.enabled, Clock.System.now())
            findParty(partyId, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}
