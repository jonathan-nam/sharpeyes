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

// Like the client-error endpoint beside it, this is unauthenticated, so what it writes to the log
// is part of its contract.
//
// The allowlist is the interesting half, because dropping is silent: "inventory-ready" sat in it
// with a threshold of its own while nothing in the frontend ever sent that name, so the one metric
// that measures what a user actually waits for was collected nowhere and nothing said so. The
// frontend half of that agreement is pinned in frontend/lib/rum-names.test.ts.
class VitalsRoutesTest {
    private val appender = ListAppender<ILoggingEvent>()
    private val logger = LoggerFactory.getLogger("Rum") as Logger

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
                    route("/api/vitals") { vitalsRoutes() }
                }
            }
            val response = client.post("/api/vitals") { setBody(body) }
            assertEquals(HttpStatusCode.NoContent, response.status)
        }

    private fun logged(): List<String> = appender.list.map { it.formattedMessage }

    @Test
    fun `a data-ready report is logged with the route it came from`() {
        post("""{"name":"data-ready","value":1200,"route":"/bosses/drops","nav":"reload"}""")

        val line = logged().single()
        assertTrue(line.contains("rum data-ready=1200"), line)
        assertTrue(line.contains("route=/bosses/drops"), line)
        assertTrue(line.contains("nav=reload"), line)
        assertEquals(Level.INFO, appender.list.single().level)
    }

    // The 2.8s load that prompted the metric. It has to come out greppable, or the number is
    // collected and never looked at, which is where this started.
    @Test
    fun `a data-ready past the bar is SLOW and louder`() {
        post("""{"name":"data-ready","value":2800,"route":"/bosses/drops"}""")

        val line = logged().single()
        assertTrue(line.startsWith("SLOW "), line)
        assertEquals(Level.WARN, appender.list.single().level)
    }

    @Test
    fun `a data-ready inside the bar is not SLOW`() {
        post("""{"name":"data-ready","value":2400,"route":"/bosses/drops"}""")

        assertTrue(!logged().single().startsWith("SLOW "), logged().single())
        assertEquals(Level.INFO, appender.list.single().level)
    }

    // A soft nav is timed from the route change, a hard one from navigation start. They measure
    // different spans, so the line has to say which, or the two pool into an average of neither.
    @Test
    fun `a client-side nav says so`() {
        post("""{"name":"data-ready","value":900,"route":"/bosses/parties","nav":"soft"}""")

        assertTrue(logged().single().contains("nav=soft"), logged().single())
    }

    // The name this replaced. Kept as a test rather than a memory: it is exactly the shape of
    // report that gets dropped in silence.
    @Test
    fun `a name nobody sends any more is dropped rather than echoed`() {
        post("""{"name":"inventory-ready","value":1200,"route":"/inventory"}""")

        assertTrue(logged().isEmpty(), logged().toString())
    }

    @Test
    fun `a core web vital still gets through`() {
        post("""{"name":"LCP","value":685,"rating":"good","route":"/bosses/drops"}""")

        val line = logged().single()
        assertTrue(line.contains("rum LCP=685"), line)
        assertTrue(line.contains("rating=good"), line)
    }

    @Test
    fun `a negative duration is dropped`() {
        post("""{"name":"data-ready","value":-1,"route":"/bosses/drops"}""")

        assertTrue(logged().isEmpty(), logged().toString())
    }

    @Test
    fun `malformed json is dropped, not turned into noise`() {
        post("not json at all")

        assertTrue(logged().isEmpty(), logged().toString())
    }
}
