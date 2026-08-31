package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.configureSerialization
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * What a save's outcome comes back as, by the kind of thing it is.
 *
 * The one dispatch every party write goes out through, and the difference between a 400, a 409 and
 * a 500 is which branch a type falls into. It takes `Any?`, so a kind nobody matched is not a
 * compile error: it is a 500 on a request that was perfectly writable. The clash arrived that way
 * and this is here so the next one cannot.
 */
class RespondToSaveTest {
    private fun serving(outcome: Any?) =
        testApplication {
            application {
                configureSerialization()
                routing { post("/save") { respondToSave(outcome, HttpStatusCode.OK) } }
            }
            val response = client.post("/save")
            when (outcome) {
                null -> assertEquals(HttpStatusCode.NotFound, response.status)
                is String -> {
                    assertEquals(HttpStatusCode.BadRequest, response.status)
                    assertEquals(outcome, response.bodyAsText())
                }
                is RosterConflictResponse -> {
                    // Not a 400. The request is writable and one question stands, which is what the
                    // client tells apart by status before it reads the body at all.
                    assertEquals(HttpStatusCode.Conflict, response.status)
                    assertEquals(
                        """{"message":"held","moves":[{"partyId":"p1","member":"CourseLair",""" +
                            """"fromCharacter":"HuskyxKenshi","removesParty":true}]}""",
                        response.bodyAsText(),
                    )
                }
                else -> assertEquals(HttpStatusCode.InternalServerError, response.status)
            }
        }

    @Test
    fun `a config that is not yours is a 404`() = serving(null)

    @Test
    fun `a rule the request breaks is a 400, with the reason as the body`() =
        serving("a party needs somebody else in it")

    @Test
    fun `a clash is a 409, carrying the move the screen is going to offer`() =
        serving(
            RosterConflictResponse(
                "held",
                listOf(RosterMoveResponse("p1", "CourseLair", "HuskyxKenshi", removesParty = true)),
            ),
        )

    @Test
    fun `a kind nobody matched is a 500 rather than a silent 200`() = serving(42)
}
