package com.sharpeyes.backend.plugins

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.HttpStatusCode
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import org.slf4j.LoggerFactory
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The endpoint is unauthenticated, so anyone on the internet can post to it. What it writes to the
// log is therefore part of its contract, not an implementation detail.
class ClientErrorRoutesTest {
    private val appender = ListAppender<ILoggingEvent>()
    private val logger = LoggerFactory.getLogger("ClientError") as Logger

    @BeforeTest
    fun attach() {
        appender.start()
        logger.addAppender(appender)
    }

    @AfterTest
    fun detach() {
        logger.detachAppender(appender)
        appender.stop()
    }

    private fun post(body: String) =
        testApplication {
            application {
                routing {
                    route("/api/errors") { clientErrorRoutes() }
                }
            }
            val response = client.post("/api/errors") { setBody(body) }
            assertEquals(HttpStatusCode.NoContent, response.status)
        }

    private fun logged(): List<String> = appender.list.map { it.formattedMessage }

    @Test
    fun `an http failure is logged with its status and endpoint`() {
        post("""{"kind":"http","path":"/api/parties","status":401,"route":"/bosses/parties"}""")

        val line = logged().single()
        assertTrue(line.contains("client http"), line)
        assertTrue(line.contains("path=/api/parties"), line)
        assertTrue(line.contains("status=401"), line)
        assertTrue(line.contains("route=/bosses/parties"), line)
        assertEquals(Level.WARN, appender.list.single().level)
    }

    // The case the server cannot see for itself: no response ever arrived, so nothing else in the
    // system knows the request happened.
    @Test
    fun `a network failure needs no status`() {
        post("""{"kind":"network","path":"/api/parties","route":"/bosses/parties"}""")

        val line = logged().single()
        assertTrue(line.contains("client network"), line)
        assertTrue(!line.contains("status="), line)
    }

    @Test
    fun `an unrecognised kind is dropped rather than echoed`() {
        post("""{"kind":"whatever-i-typed","path":"/api/parties"}""")

        assertTrue(logged().isEmpty(), logged().toString())
    }

    @Test
    fun `malformed json is dropped, not turned into noise`() {
        post("not json at all")

        assertTrue(logged().isEmpty(), logged().toString())
    }

    // A caller must not be able to close the line and forge a field after it. The separators are
    // what carry that, so the text survives (harmlessly) and the ` key=value` shape does not.
    @Test
    fun `a value cannot forge a field of its own`() {
        post("""{"kind":"http","path":"/api/parties status=200","route":"a\nb"}""")

        val line = logged().single()
        assertTrue(line.contains("path=/api/partiesstatus200"), line)
        assertTrue(!line.contains(" status=200"), line)
        assertTrue(!line.contains("\n"), line)
        assertTrue(line.contains("route=ab"), line)
    }

    // The client strips these too, which is not a reason to trust that it did. Anyone can post
    // here, so the endpoint has to keep its own promise of being anonymous.
    @Test
    fun `an id in the path is dropped even when the client sends one`() {
        post(
            """{"kind":"http","path":"/api/parties/3f2504e0-4f89-11d3-9a0c-0305e82c3301/loot","status":500}""",
        )

        val line = logged().single()
        assertTrue(line.contains("path=/api/parties/:id/loot"), line)
        assertTrue(!line.contains("3f2504e0"), line)
    }

    @Test
    fun `a parity report names where the figures differ and how many`() {
        post("""{"kind":"parity","field":"view.settlement.2.mesos","count":3,"route":"/bosses/drops"}""")

        val line = logged().single()
        assertTrue(line.contains("client parity"), line)
        assertTrue(line.contains("field=view.settlement.2.mesos"), line)
        assertTrue(line.contains("count=3"), line)
    }

    @Test
    fun `a parity field that is not a json path is dropped`() {
        post("""{"kind":"parity","field":"1320000000 owed to someone","count":1}""")

        assertTrue(!logged().single().contains("field="), logged().single())
    }

    @Test
    fun `a status outside the http range is dropped`() {
        post("""{"kind":"http","path":"/api/parties","status":99999}""")

        assertTrue(!logged().single().contains("status="), logged().single())
    }
}
