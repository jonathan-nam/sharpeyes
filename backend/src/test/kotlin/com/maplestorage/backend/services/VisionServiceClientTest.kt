package com.maplestorage.backend.services

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.errors.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Exercises the wire contract the Python vision service actually serves
// (vision/app/main.py).
// The response bodies below are copied from its real output, not invented.
class VisionServiceClientTest {
    private fun service(handler: MockEngine.Companion.() -> MockEngine): VisionServiceClient {
        val engine = MockEngine.handler()
        val client =
            HttpClient(engine) {
                install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
            }
        return VisionServiceClient(client, "http://127.0.0.1:8000")
    }

    private fun ok(body: String) =
        service {
            MockEngine {
                respond(body, HttpStatusCode.OK, headersOf("Content-Type", ContentType.Application.Json.toString()))
            }
        }

    @Test
    fun `parses an inventory screenshot into tokens and hud`() =
        runTest {
            val outcome =
                ok(
                    """
                    {"screenshotType":"INVENTORY",
                     "characterHud":{"name":"acornacorn","level":287},
                     "tokenCounts":[
                       {"tokenName":"kalos-token","quantity":21,"iconScore":0.964},
                       {"tokenName":"distorted-ambition","quantity":10,"iconScore":0.606}]}
                    """.trimIndent(),
                ).parseScreenshot(ByteArray(8), "image/jpeg")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertEquals(ScreenshotType.INVENTORY, parsed.result.screenshotType)
            assertEquals(CharacterHud("acornacorn", 287), parsed.result.characterHud)
            assertEquals(
                listOf(DetectedToken("kalos-token", 21), DetectedToken("distorted-ambition", 10)),
                parsed.result.tokenCounts,
            )
        }

    // The flag that lets ingestion clear a vanished item. It was served by
    // vision and dropped here for want of a DTO field, and ignoreUnknownKeys
    // meant nothing complained: 50 Kaling pieces survived a capture with none.
    // Any new field vision serves needs a case like this one.
    @Test
    fun `carries inventoryComplete through from the wire`() =
        runTest {
            val outcome =
                ok(
                    """
                    {"screenshotType":"INVENTORY",
                     "characterHud":{"name":"mechyfechy","level":291},
                     "tokenCounts":[{"tokenName":"kalos-token","quantity":21,"iconScore":0.964}],
                     "inventoryComplete":true}
                    """.trimIndent(),
                ).parseScreenshot(ByteArray(8), "image/jpeg")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertEquals(true, parsed.result.inventoryComplete)
        }

    // Absent means "not known to be complete", which must stay null rather than
    // collapsing to false, since ingestion distinguishes them.
    @Test
    fun `an absent inventoryComplete stays null`() =
        runTest {
            val outcome =
                ok("""{"screenshotType":"INVENTORY","characterHud":null,"tokenCounts":[]}""")
                    .parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertNull(parsed.result.inventoryComplete)
        }

    // The parse is deterministic, so cost accounting must land at zero rather
    // than at whatever the last vision call happened to cost.
    @Test
    fun `reports zero tokens because no model is called`() =
        runTest {
            val outcome =
                ok("""{"screenshotType":"INVENTORY","characterHud":null,"tokenCounts":[]}""")
                    .parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
        }

    // A cropped upload has no HUD in frame. Null, not an error. Ingestion
    // already routes that to NEEDS_REVIEW.
    @Test
    fun `a missing hud is null, not a failure`() =
        runTest {
            val outcome =
                ok(
                    """
                    {"screenshotType":"INVENTORY","characterHud":null,
                     "tokenCounts":[{"tokenName":"kalos-token","quantity":19,
                                     "iconScore":0.77}]}
                    """.trimIndent(),
                ).parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertNull(parsed.result.characterHud)
            assertEquals(1, parsed.result.tokenCounts?.size)
        }

    // Body trimmed from a real /parse of test-fixtures/planner/boss clear menu sample 2.png against the
    // running service (11 rows, 3 cleared, reachedListEnd true, 0 unreadable). The fields this
    // pins are the ones that silently become null if the DTO and the service drift: an absent
    // bossClears reads exactly like a capture with no planner in it.
    @Test
    fun `parses a planner screenshot into boss clears`() =
        runTest {
            val outcome =
                ok(
                    """
                    {"screenshotType":"PLANNER","characterHud":null,"tokenCounts":null,
                     "bossClears":[{"bossKey":"darknell","cleared":true},
                                   {"bossKey":"chosen-seren","cleared":true},
                                   {"bossKey":"first-adversary","cleared":false}],
                     "reachedListEnd":true,"unreadableBossRows":0}
                    """.trimIndent(),
                ).parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertEquals(ScreenshotType.PLANNER, parsed.result.screenshotType)
            assertEquals(
                listOf(
                    DetectedBossClear("darknell", true),
                    DetectedBossClear("chosen-seren", true),
                    DetectedBossClear("first-adversary", false),
                ),
                parsed.result.bossClears,
            )
            assertEquals(true, parsed.result.reachedListEnd)
            assertEquals(0, parsed.result.unreadableBossRows)
            assertNull(parsed.result.tokenCounts)
        }

    // One capture holding both panels is the normal case, not a corner one, so the two payloads
    // have to survive the same response. Picking one would silently drop the other's real data.
    @Test
    fun `one capture can carry both an inventory and a planner`() =
        runTest {
            val outcome =
                ok(
                    """
                    {"screenshotType":"INVENTORY","characterHud":null,
                     "tokenCounts":[{"tokenName":"kalos-token","quantity":21,"iconScore":0.96}],
                     "bossClears":[{"bossKey":"lotus","cleared":true}],
                     "reachedListEnd":false,"unreadableBossRows":0}
                    """.trimIndent(),
                ).parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertEquals(ScreenshotType.INVENTORY, parsed.result.screenshotType)
            assertEquals(listOf(DetectedToken("kalos-token", 21)), parsed.result.tokenCounts)
            assertEquals(listOf(DetectedBossClear("lotus", true)), parsed.result.bossClears)
            assertEquals(false, parsed.result.reachedListEnd)
        }

    // An inventory with no planner in frame. Null rather than empty, and ingestion must not write
    // a routine of zero bosses off the back of it.
    @Test
    fun `an inventory with no planner carries no clears`() =
        runTest {
            val outcome =
                ok("""{"screenshotType":"INVENTORY","characterHud":null,"tokenCounts":[]}""")
                    .parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertNull(parsed.result.bossClears)
            assertNull(parsed.result.reachedListEnd)
            assertNull(parsed.result.unreadableBossRows)
        }

    @Test
    fun `a non-inventory upload is UNRECOGNIZED, not a failure`() =
        runTest {
            val outcome =
                ok("""{"screenshotType":"UNRECOGNIZED","characterHud":null,"tokenCounts":null}""")
                    .parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertEquals(ScreenshotType.UNRECOGNIZED, parsed.result.screenshotType)
            assertNull(parsed.result.tokenCounts)
        }

    // The vision service refuses any capture it cannot read reliably, and its
    // message tells the user how to fix the capture. That message must reach
    // them intact. "parsing failed" is not actionable; "set display scaling to
    // 100%" is.
    @Test
    fun `an unreadable capture fails with the service's own explanation`() =
        runTest {
            val outcome =
                service {
                    MockEngine {
                        respond(
                            """
                            {"detail":"This screenshot was captured at a scaled resolution.
                             Set your display scaling to 100%, then take it again."}
                            """.trimIndent(),
                            HttpStatusCode.UnprocessableEntity,
                            headersOf("Content-Type", ContentType.Application.Json.toString()),
                        )
                    }
                }.parseScreenshot(ByteArray(8), "image/jpeg")

            val failed = assertIs<ScreenshotParseOutcome.Failed>(outcome)
            assertTrue(failed.reason.contains("display scaling"), failed.reason)
        }

    @Test
    fun `an undecodable file fails`() =
        runTest {
            val outcome =
                service { MockEngine { respondError(HttpStatusCode.BadRequest) } }
                    .parseScreenshot(ByteArray(8), "image/png")

            assertIs<ScreenshotParseOutcome.Failed>(outcome)
        }

    // A vision container that is down is an infrastructure fault, not a bad
    // screenshot: it must not throw out of parseScreenshot, and the user must be
    // able to retry the same upload.
    @Test
    fun `an unreachable vision service fails without throwing`() =
        runTest {
            val outcome =
                service { MockEngine { throw IOException("connection refused") } }
                    .parseScreenshot(ByteArray(8), "image/png")

            val failed = assertIs<ScreenshotParseOutcome.Failed>(outcome)
            assertTrue(failed.reason.contains("temporarily unavailable"), failed.reason)
        }

    // Contract test against a response captured from the *live* vision service
    // (vision/), not hand-written JSON. If the Python side changes its wire
    // format, this fails here rather than in production.
    @Test
    fun `decodes a response captured from the running vision service`() =
        runTest {
            val golden =
                requireNotNull(javaClass.getResourceAsStream("/vision-inventory-response.json")) {
                    "golden vision response missing from test resources"
                }.readBytes().decodeToString()

            val outcome =
                ok(golden).parseScreenshot(ByteArray(8), "image/png")

            val parsed = assertIs<ScreenshotParseOutcome.Parsed>(outcome)
            assertEquals(ScreenshotType.INVENTORY, parsed.result.screenshotType)
            assertEquals(CharacterHud("acornacorn", 287), parsed.result.characterHud)
            // The five tokens visible in test-fixtures/inventory/untradeables sample.png,
            // read off the screenshot by eye.
            assertEquals(
                mapOf(
                    "blissful-fantasy-shard" to 6,
                    "distorted-ambition" to 10,
                    "echo-ancient-resolve" to 6,
                    "ferocious-beast-ring" to 9,
                    "kalos-token" to 21,
                ),
                parsed.result.tokenCounts?.associate { it.tokenName to it.quantity },
            )
        }

    // ---- Authoring: finding what is NOT in the catalog, and cutting it out ----------------

    private fun golden(name: String) =
        requireNotNull(javaClass.getResourceAsStream("/$name")) {
            "golden vision response missing from test resources: $name"
        }.readBytes().decodeToString()

    @Test
    fun `decodes a discover response captured from the running vision service`() =
        runTest {
            val outcome = ok(golden("vision-discover-response.json")).discoverUntracked(ByteArray(8), "image/png")

            val found = assertIs<DiscoverOutcome.Found>(outcome)
            // The capture's own numbers: 25 slots the catalog claims, and the rest offerable.
            // Trimmed to three slots in the golden, because the wire shape is the contract.
            assertEquals(25, found.knownCount)
            assertEquals(3, found.slots.size)
            assertEquals(0, found.slots[0].row)
            assertEquals(0, found.slots[0].col)
            assertTrue(found.slots.all { it.imagePng.isNotBlank() }, "a slot with no pixels is useless to a picker")
        }

    @Test
    fun `decodes a template response captured from the running vision service`() =
        runTest {
            val outcome =
                ok(golden("vision-template-response.json")).cutTemplate(ByteArray(8), "image/png", 0, 0)

            val cut = assertIs<TemplateOutcome.Cut>(outcome)
            assertTrue(cut.templatePng.isNotBlank())
            assertTrue(cut.coverage > 0.0 && cut.coverage <= 1.0, "coverage was ${cut.coverage}")
        }

    @Test
    fun `an already-tracked item is a conflict, not a failed capture`() =
        runTest {
            // The distinction the whole outcome type exists for. A 409 means the capture was
            // fine, so telling the user to re-take it would send them to fix nothing.
            val outcome =
                service {
                    MockEngine {
                        respond(
                            """{"detail":"This looks like an item already in the catalog: kalos-token"}""",
                            HttpStatusCode.Conflict,
                            headersOf("Content-Type", ContentType.Application.Json.toString()),
                        )
                    }
                }.cutTemplate(ByteArray(8), "image/png", 0, 0)

            val tracked = assertIs<TemplateOutcome.AlreadyTracked>(outcome)
            assertTrue(tracked.reason.contains("kalos-token"), tracked.reason)
        }

    @Test
    fun `a rescaled capture is refused with the service's own wording`() =
        runTest {
            val detail =
                "slot pitch is 61.0px, not the client's native 46px. this screenshot has been rescaled"
            val outcome =
                service {
                    MockEngine {
                        respond(
                            """{"detail":"$detail"}""",
                            HttpStatusCode.UnprocessableEntity,
                            headersOf("Content-Type", ContentType.Application.Json.toString()),
                        )
                    }
                }.cutTemplate(ByteArray(8), "image/png", 0, 0)

            assertEquals(detail, assertIs<TemplateOutcome.Failed>(outcome).reason)
        }

    @Test
    fun `discover fails without throwing when the vision service is unreachable`() =
        runTest {
            val outcome =
                service { MockEngine { throw IOException("connection refused") } }
                    .discoverUntracked(ByteArray(8), "image/png")

            assertIs<DiscoverOutcome.Failed>(outcome)
        }

    @Test
    fun `cutting fails without throwing when the vision service is unreachable`() =
        runTest {
            val outcome =
                service { MockEngine { throw IOException("connection refused") } }
                    .cutTemplate(ByteArray(8), "image/png", 0, 0)

            // Not AlreadyTracked: an unreachable container must never read as "nothing to add".
            assertIs<TemplateOutcome.Failed>(outcome)
        }

    @Test
    fun `an undecodable file is refused by both authoring routes`() =
        runTest {
            assertIs<DiscoverOutcome.Failed>(
                service { MockEngine { respondError(HttpStatusCode.BadRequest) } }
                    .discoverUntracked(ByteArray(8), "image/png"),
            )
            assertIs<TemplateOutcome.Failed>(
                service { MockEngine { respondError(HttpStatusCode.BadRequest) } }
                    .cutTemplate(ByteArray(8), "image/png", 0, 0),
            )
        }

    @Test
    fun `the slot is carried to the service as query parameters`() =
        runTest {
            var seen: String? = null
            val svc =
                service {
                    MockEngine { request ->
                        seen = request.url.toString()
                        respond(
                            golden("vision-template-response.json"),
                            HttpStatusCode.OK,
                            headersOf("Content-Type", ContentType.Application.Json.toString()),
                        )
                    }
                }
            svc.cutTemplate(ByteArray(8), "image/png", 3, 7)

            // A silently dropped row/col would cut the WRONG slot and store it under the name
            // the user typed for a different item.
            assertTrue(seen!!.contains("row=3"), seen!!)
            assertTrue(seen!!.contains("col=7"), seen!!)
        }
}
