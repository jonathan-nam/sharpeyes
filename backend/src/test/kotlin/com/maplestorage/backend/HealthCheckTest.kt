package com.maplestorage.backend

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

// Exercises only the unauthenticated /health route directly (not through
// Application.module()), since the rest of the module requires DB_HOST/
// AUTH_JWKS_URL etc. to be set, those get their own integration coverage
// once M1/M2 introduce real DB-backed endpoints to test against.
class HealthCheckTest {
    @Test
    fun `health endpoint returns ok`() =
        testApplication {
            application {
                install(ContentNegotiation) { json(Json) }
                routing {
                    get("/health") { call.respond(mapOf("status" to "ok")) }
                }
            }

            val response = client.get("/health")
            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals("""{"status":"ok"}""", response.bodyAsText())
        }
}
