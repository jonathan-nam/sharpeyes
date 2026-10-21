package com.sharpeyes.backend.services

import com.sharpeyes.backend.users.GmsWorld
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val EMPTY_RANKS_BODY = """{"totalCount":0,"ranks":[]}"""

private fun matchBody(
    level: Int,
    jobName: String,
    spriteUrl: String,
    characterName: String = "Whoever",
) = """{"totalCount":1,"ranks":[{"characterName":"$characterName","level":$level,""" +
    """"jobName":"$jobName","characterImgURL":"$spriteUrl"}]}"""

private fun jsonEngine(handler: (worldId: String?) -> String) =
    MockEngine { request ->
        respond(
            content = handler(request.url.parameters["id"]),
            status = HttpStatusCode.OK,
            headers = headersOf(HttpHeaders.ContentType, "application/json"),
        )
    }

private fun clientFor(engine: MockEngine) =
    HttpClient(engine) {
        install(ContentNegotiation) { json() }
    }

class NexonLookupServiceTest {
    @Test
    fun `returns null when all worlds have no match`() =
        runBlocking {
            val service = NexonLookupService(clientFor(jsonEngine { EMPTY_RANKS_BODY }))
            assertNull(service.lookup("NobodyHome"))
        }

    @Test
    fun `returns the match when exactly one world has it`() =
        runBlocking {
            val engine =
                jsonEngine { worldId ->
                    if (worldId == "45") {
                        matchBody(300, "Shadower", "https://msavatar1.nexon.net/x.png", "MisaoMaki")
                    } else {
                        EMPTY_RANKS_BODY
                    }
                }
            val result = NexonLookupService(clientFor(engine)).lookup("MisaoMaki")

            assertEquals(300, result?.level)
            assertEquals("Shadower", result?.jobName)
            assertEquals("https://msavatar1.nexon.net/x.png", result?.spriteImgUrl)
            // Which world answered is the answer to "where is this character", and it is the only
            // one there is: nobody types their world, and a tick nobody checks is how six
            // characters ended up recorded in a world they were not in. Id 45 is Kronos.
            assertEquals(GmsWorld.KRONOS, result?.world)
        }

    @Test
    fun `the world reported is the one that answered, not the one probed first`() =
        runBlocking {
            // Id 19 is Scania, and it is neither the first id probed nor the last. A fan-out that
            // reported its own iteration order rather than the responding world would pass the
            // test above and be wrong for every character outside Kronos.
            val engine =
                jsonEngine { worldId ->
                    if (worldId == "19") {
                        matchBody(296, "Night Lord", "https://msavatar1.nexon.net/z.png", "tidelark")
                    } else {
                        EMPTY_RANKS_BODY
                    }
                }
            val result = NexonLookupService(clientFor(engine)).lookup("tidelark")

            assertEquals(GmsWorld.SCANIA, result?.world)
            assertEquals(WORLD_INTERACTIVE, result?.world?.worldType)
        }

    @Test
    fun `one world erroring does not prevent another world's match from being returned`() =
        runBlocking {
            val engine =
                MockEngine { request ->
                    if (request.url.parameters["id"] == "1") {
                        respondError(HttpStatusCode.InternalServerError)
                    } else if (request.url.parameters["id"] == "19") {
                        respond(
                            content = matchBody(120, "Night Lord", "https://msavatar1.nexon.net/y.png"),
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    } else {
                        respond(
                            content = EMPTY_RANKS_BODY,
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    }
                }
            val result = NexonLookupService(clientFor(engine)).lookup("Whoever")

            assertEquals(120, result?.level)
        }

    @Test
    fun `the name returned is Nexon's spelling, not the one asked for`() =
        runBlocking {
            val engine =
                jsonEngine { worldId ->
                    if (worldId == "19") {
                        matchBody(296, "Adele", "https://msavatar1.nexon.net/h.png", "MarrowWind")
                    } else {
                        EMPTY_RANKS_BODY
                    }
                }

            assertEquals("MarrowWind", NexonLookupService(clientFor(engine)).lookup("marrowwind")?.name)
        }

    @Test
    fun `a row for a different character than the one asked for is not a match`() =
        runBlocking {
            // Nexon truncates character_name to 12 characters (the in-game limit) before matching,
            // so a 14-character typo comes back holding MarrowWind's level, job and sprite.
            // Taking it would put another player's numbers under the name that was typed.
            val engine =
                jsonEngine { matchBody(296, "Adele", "https://msavatar1.nexon.net/h.png", "MarrowWind") }

            assertNull(NexonLookupService(clientFor(engine)).lookup("marrowwindyz"))
        }

    @Test
    fun `malformed JSON on one world does not crash the others`() =
        runBlocking {
            val engine =
                jsonEngine { worldId ->
                    if (worldId == "1") "not json at all" else EMPTY_RANKS_BODY
                }
            assertNull(NexonLookupService(clientFor(engine)).lookup("Whoever"))
        }
}
