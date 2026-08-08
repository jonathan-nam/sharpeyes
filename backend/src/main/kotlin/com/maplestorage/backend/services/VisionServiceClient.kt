package com.maplestorage.backend.services

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.errors.IOException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger(VisionServiceClient::class.java)

// The vision service is a second container in the same ECS task, so this is a
// loopback call. There is no network to be slow or flaky, and no retry logic
// worth writing. A parse is ~0.3s of CPU; the timeout only exists to stop a
// wedged vision container from holding a request thread forever.
private const val PARSE_TIMEOUT_MS = 15_000L

// Recorded against each screenshot in place of a model id. Cost accounting
// multiplies tokens by a per-model rate, and this service reports zero tokens,

private const val VISION_UNAVAILABLE = "Screenshot parsing is temporarily unavailable."
private const val CANNOT_READ = "That screenshot could not be read."
private const val NOT_AN_IMAGE = "That file could not be read as an image."

fun createVisionHttpClient(): HttpClient =
    HttpClient(CIO) {
        install(ContentNegotiation) {
            // The vision service sends fields the Kotlin DTOs do not model yet
            // (iconScore); ignoring them keeps the two sides independently
            // deployable.
            json(Json { ignoreUnknownKeys = true })
        }
        engine { requestTimeout = PARSE_TIMEOUT_MS }
    }

@Serializable
private data class VisionToken(
    val tokenName: String,
    val quantity: Int,
)

@Serializable
private data class VisionHud(
    val name: String,
    val level: Int,
)

@Serializable
private data class VisionBossClear(
    val bossKey: String,
    val cleared: Boolean,
)

@Serializable
private data class VisionResult(
    val screenshotType: String,
    val characterHud: VisionHud? = null,
    val tokenCounts: List<VisionToken>? = null,
    val bossClears: List<VisionBossClear>? = null,
    val reachedListEnd: Boolean? = null,
    val unreadableBossRows: Int? = null,
    val inventoryComplete: Boolean? = null,
)

@Serializable
private data class VisionError(
    @SerialName("detail") val detail: String? = null,
)

@Serializable
private data class VisionUntrackedSlot(
    val row: Int,
    val col: Int,
    val imagePng: String,
)

@Serializable
private data class VisionDiscoverResult(
    val slots: List<VisionUntrackedSlot>,
    val knownCount: Int,
)

@Serializable
private data class VisionTemplateResult(
    val templatePng: String,
    val coverage: Double,
)

/**
 * Parses screenshots by calling the co-located OpenCV vision service, rather
 * than a vision model.
 *
 * The service runs as a second container in the same ECS task (see `vision/`),
 * so this is a loopback call: one deployable, two processes.
 *
 * The parse is deterministic: no third-party call, no metering, same answer every
 * time for the same bytes.
 */
class VisionServiceClient(
    private val client: HttpClient,
    private val baseUrl: String,
) : ScreenshotParser,
    ItemAuthoring {
    override suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ScreenshotParseOutcome {
        // A vision container that is down or wedged is an infrastructure fault,
        // not a bad screenshot: FAILED lets the user retry the same upload once
        // it recovers.
        val response =
            send("/parse", imageBytes, mediaType)
                ?: return ScreenshotParseOutcome.Failed(VISION_UNAVAILABLE)

        return when (response.status) {
            HttpStatusCode.OK -> parsed(response.body())

            // The vision service refuses any capture it cannot read reliably.
            // Shrunk before upload, or taken at a scaled display resolution.
            // Rather than returning a plausible wrong count. Its message tells
            // the user how to fix the capture, so pass it straight through
            // instead of flattening it to a generic failure.
            HttpStatusCode.UnprocessableEntity -> ScreenshotParseOutcome.Failed(detail(response.bodyAsText()))

            HttpStatusCode.BadRequest -> ScreenshotParseOutcome.Failed(NOT_AN_IMAGE)

            else -> {
                log.error("vision service returned {}: {}", response.status, response.bodyAsText())
                ScreenshotParseOutcome.Failed("Screenshot parsing failed.")
            }
        }
    }

    private fun parsed(body: VisionResult): ScreenshotParseOutcome {
        val type =
            when (body.screenshotType) {
                "INVENTORY" -> ScreenshotType.INVENTORY
                "PLANNER" -> ScreenshotType.PLANNER
                else -> ScreenshotType.UNRECOGNIZED
            }

        val result =
            ScreenshotParseResult(
                screenshotType = type,
                characterHud = body.characterHud?.let { CharacterHud(name = it.name, level = it.level) },
                tokenCounts = body.tokenCounts?.map { DetectedToken(it.tokenName, it.quantity) },
                bossClears = body.bossClears?.map { DetectedBossClear(it.bossKey, it.cleared) },
                reachedListEnd = body.reachedListEnd,
                unreadableBossRows = body.unreadableBossRows,
                inventoryComplete = body.inventoryComplete,
            )
        return ScreenshotParseOutcome.Parsed(result = result)
    }

    override suspend fun discoverUntracked(
        imageBytes: ByteArray,
        mediaType: String,
    ): DiscoverOutcome {
        val response =
            send("/discover", imageBytes, mediaType)
                ?: return DiscoverOutcome.Failed(VISION_UNAVAILABLE)

        return when (response.status) {
            HttpStatusCode.OK ->
                response.body<VisionDiscoverResult>().let { body ->
                    DiscoverOutcome.Found(
                        slots = body.slots.map { UntrackedSlot(it.row, it.col, it.imagePng) },
                        knownCount = body.knownCount,
                    )
                }

            HttpStatusCode.UnprocessableEntity ->
                DiscoverOutcome.Failed(detail(response.bodyAsText(), CANNOT_READ))

            HttpStatusCode.BadRequest -> DiscoverOutcome.Failed(NOT_AN_IMAGE)

            else -> {
                log.error("vision /discover returned {}: {}", response.status, response.bodyAsText())
                DiscoverOutcome.Failed(CANNOT_READ)
            }
        }
    }

    override suspend fun cutTemplate(
        imageBytes: ByteArray,
        mediaType: String,
        row: Int,
        col: Int,
    ): TemplateOutcome {
        val response =
            send("/admit?row=$row&col=$col", imageBytes, mediaType)
                ?: return TemplateOutcome.Failed(VISION_UNAVAILABLE)

        return when (response.status) {
            HttpStatusCode.OK ->
                response.body<VisionTemplateResult>().let {
                    TemplateOutcome.Cut(templatePng = it.templatePng, coverage = it.coverage)
                }

            // Kept apart from the 422 below on purpose. See TemplateOutcome.AlreadyTracked:
            // one means fix the capture, the other means the capture was never the problem.
            HttpStatusCode.Conflict ->
                TemplateOutcome.AlreadyTracked(detail(response.bodyAsText(), "This item is already tracked."))

            HttpStatusCode.UnprocessableEntity ->
                TemplateOutcome.Failed(detail(response.bodyAsText(), CANNOT_READ))

            HttpStatusCode.BadRequest -> TemplateOutcome.Failed(NOT_AN_IMAGE)

            else -> {
                log.error("vision /admit returned {}: {}", response.status, response.bodyAsText())
                TemplateOutcome.Failed(CANNOT_READ)
            }
        }
    }

    /** POST the capture, or null when the vision container itself is the problem. */
    private suspend fun send(
        path: String,
        imageBytes: ByteArray,
        mediaType: String,
    ) = try {
        client.post("$baseUrl$path") {
            contentType(ContentType.parse(mediaType))
            setBody(imageBytes)
        }
    } catch (e: IOException) {
        log.error("vision service unreachable at {}", baseUrl, e)
        null
    } catch (e: HttpRequestTimeoutException) {
        log.error("vision service timed out after {}ms", PARSE_TIMEOUT_MS, e)
        null
    }

    private fun detail(
        raw: String,
        fallback: String = "That screenshot could not be parsed.",
    ): String =
        try {
            Json { ignoreUnknownKeys = true }.decodeFromString<VisionError>(raw).detail
        } catch (e: SerializationException) {
            log.warn("could not read vision error body: {}", raw, e)
            null
        } ?: fallback
}
