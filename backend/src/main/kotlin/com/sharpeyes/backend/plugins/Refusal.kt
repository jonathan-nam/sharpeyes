package com.sharpeyes.backend.plugins

import com.sharpeyes.api.system.Refusal
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.respond

suspend fun ApplicationCall.refuse(
    status: HttpStatusCode,
    refusal: Refusal,
) = respond(status, refusal)
