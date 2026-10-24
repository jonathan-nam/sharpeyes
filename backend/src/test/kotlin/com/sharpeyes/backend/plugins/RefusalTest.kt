package com.sharpeyes.backend.plugins

import com.sharpeyes.api.system.Refusal
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

// The frontend shows a body only when it parses as exactly this shape (lib/api.ts refusalIn).
class RefusalTest {
    @Test
    fun `a refusal goes out as the JSON the frontend reads`() =
        testApplication {
            application { configureSerialization() }
            routing {
                get(
                    "/shown",
                ) { call.refuse(HttpStatusCode.BadRequest, Refusal("Two people share a name. Rename one.")) }
            }
            val response = client.get("/shown")
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals("""{"refusal":"Two people share a name. Rename one."}""", response.bodyAsText())
        }
}
