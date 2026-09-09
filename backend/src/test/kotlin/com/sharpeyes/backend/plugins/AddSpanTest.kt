package com.sharpeyes.backend.plugins

import io.ktor.client.request.get
import io.ktor.client.statement.HttpResponse
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds

/**
 * A span taken outside [span] still reaches the header.
 *
 * Worth a test because the two paths could easily diverge: [span] wraps a suspend block and
 * [addSpan] takes a duration measured elsewhere, and the whole point of the second one is that a
 * reader cannot tell which produced an entry. A composite endpoint times its stages inside a
 * `dbQuery { }`, where a span cannot be taken, and reports them this way.
 */
class AddSpanTest {
    @Test
    fun `a span added by hand appears in Server-Timing beside total`() =
        testApplication {
            application {
                install(Timing)
                routing {
                    get("/spanned") {
                        call.addSpan("parties", 12.milliseconds)
                        call.addSpan("pools", 34.milliseconds)
                        call.respond("ok")
                    }
                }
            }

            val response: HttpResponse = client.get("/spanned")
            val header = response.headers["Server-Timing"].orEmpty()

            assertTrue(header.contains("parties;dur=12.0"), header)
            assertTrue(header.contains("pools;dur=34.0"), header)
            // total is the plugin's own, and has to survive the added ones rather than be replaced.
            assertTrue(header.contains("total;dur="), header)
        }

    @Test
    fun `a route that adds no span still reports total`() =
        testApplication {
            application {
                install(Timing)
                routing { get("/plain") { call.respond("ok") } }
            }

            val header = client.get("/plain").headers["Server-Timing"].orEmpty()

            assertTrue(header.startsWith("total;dur="), header)
        }
}
