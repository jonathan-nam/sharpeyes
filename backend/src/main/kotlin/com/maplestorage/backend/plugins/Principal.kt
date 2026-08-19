package com.maplestorage.backend.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.response.respond
import kotlin.uuid.Uuid

// Shared by every authenticated route handler (characters/, screenshots/).
fun ApplicationCall.principalIdAndEmail(): Pair<String, String> {
    val principal = principal<JWTPrincipal>()!!
    val userId = principal.payload.subject
    // Present, because the auth service puts the whole user object in the payload. Kept lenient
    // anyway: it is only ever written to Users.email on first sight, nothing reads it, and a
    // sign-in that works should not turn on a claim nothing needs.
    val email =
        principal.payload
            .getClaim("email")
            ?.asString()
            .orEmpty()
    return userId to email
}

suspend fun ApplicationCall.parseUuidParam(name: String): Uuid? {
    val raw = parameters[name]
    val id = raw?.let { Uuid.parseOrNull(it) }
    if (id == null) {
        respond(HttpStatusCode.BadRequest, "malformed $name")
    }
    return id
}
