package com.sharpeyes.backend.parties

import com.sharpeyes.backend.plugins.Refusal
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.failing
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.refuse
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.CacheControl
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.contentLength
import io.ktor.server.request.receive
import io.ktor.server.request.receiveChannel
import io.ktor.server.response.cacheControl
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.utils.io.readRemaining
import kotlinx.io.readByteArray
import kotlinx.serialization.Serializable
import kotlin.time.Clock
import kotlin.uuid.Uuid

// /api/settlement-listings. See SettlementListings.kt. Every write answers with the caller's
// listings, so the card redraws from what is now true.

/** A screenshot, not a recording. nginx allows 20m; this is the app's own bar. */
private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024

private const val ONE_DAY_SECONDS = 86_400

private val PNG_MAGIC = "89504e470d0a1a0a".hexToByteArray()
private val JPEG_MAGIC = "ffd8ff".hexToByteArray()
private val RIFF = "RIFF".encodeToByteArray()
private val WEBP = "WEBP".encodeToByteArray()

/** Where a RIFF file names its format. */
private const val RIFF_FORMAT_AT = 8

@Serializable
data class ReportFiguresRequest(
    val figures: List<ReportedFigure>,
)

fun Route.settlementListingRoutes() {
    get { answer { } }
    get("/{id}/image") { image() }
    post("/figures") {
        val request = call.receive<ReportFiguresRequest>()
        answer { reportFigures(it, request.figures, Clock.System.now()) }
    }
    post("/cards/{personId}") { post() }
    delete("/{id}") {
        val id = call.parameters["id"]?.let(Uuid::parseOrNull)
        val (userId, email) = call.principalIdAndEmail()
        val removed = id != null && dbQuery { ensureUser(userId, email).let { removeListing(id, userId) } }
        if (removed) answer { } else call.respond(HttpStatusCode.NotFound)
    }
}

private suspend fun RoutingContext.answer(act: (String) -> Unit) {
    val (userId, email) = call.principalIdAndEmail()
    call.respond(
        dbQuery {
            ensureUser(userId, email)
            act(userId)
            listingsFor(userId)
        },
    )
}

private suspend fun RoutingContext.image() {
    val (userId, _) = call.principalIdAndEmail()
    val id = call.parameters["id"]?.let(Uuid::parseOrNull)
    val found = id?.let { dbQuery { listingImage(it, userId) } }
    if (found == null) {
        call.respond(HttpStatusCode.NotFound)
        return
    }
    // A listing is never edited, only replaced under a new id.
    call.response.cacheControl(
        CacheControl.MaxAge(maxAgeSeconds = ONE_DAY_SECONDS, visibility = CacheControl.Visibility.Private),
    )
    call.respondBytes(found.second, ContentType.parse(found.first))
}

private suspend fun RoutingContext.post() {
    val (userId, email) = call.principalIdAndEmail()
    val personId = call.parameters["personId"]?.let(Uuid::parseOrNull)
    val amount = call.request.queryParameters["amount"]?.toLongOrNull()
    if (personId == null || amount == null) return call.respond(HttpStatusCode.BadRequest)
    val (type, bytes) = readImage() ?: return
    val outcome =
        dbQuery {
            ensureUser(userId, email)
            listingCardFor(personId, userId)?.let { postListing(it, amount, type, bytes, Clock.System.now()) }
        }
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        PostOutcome.NothingOwed -> {
            call.failing("listing-nothing-owed")
            call.refuse(HttpStatusCode.BadRequest, Refusal("Nothing is owed to you here."))
        }
        PostOutcome.Stale -> {
            call.failing("listing-stale-amount")
            call.refuse(HttpStatusCode.Conflict, Refusal("The amount changed. Reload and post again."))
        }
        PostOutcome.Posted -> answer { }
    }
}

/** The body as an image and its type, or null once the refusal has been sent. */
private suspend fun RoutingContext.readImage(): Pair<String, ByteArray>? {
    val declared = call.request.contentLength()
    val bytes =
        if (declared != null && declared > MAX_IMAGE_BYTES) {
            null
        } else {
            call
                .receiveChannel()
                .readRemaining(MAX_IMAGE_BYTES + 1L)
                .readByteArray()
                .takeIf { it.size <= MAX_IMAGE_BYTES }
        }
    val type = bytes?.let(::imageTypeOf)
    if (bytes == null) {
        call.failing("listing-too-large")
        call.refuse(HttpStatusCode.PayloadTooLarge, Refusal("Screenshot is too large. Crop it and try again."))
    } else if (type == null) {
        call.failing("listing-not-an-image")
        call.refuse(HttpStatusCode.BadRequest, Refusal("Couldn't read that image. Post a PNG, JPEG or WebP."))
    }
    return if (bytes != null && type != null) type to bytes else null
}

/** The image's type by its first bytes, never by what the request claims. Null for anything else. */
internal fun imageTypeOf(bytes: ByteArray): String? {
    fun has(
        at: Int,
        magic: ByteArray,
    ) = bytes.size >= at + magic.size && magic.indices.all { bytes[at + it] == magic[it] }
    return when {
        has(0, PNG_MAGIC) -> "image/png"
        has(0, JPEG_MAGIC) -> "image/jpeg"
        has(0, RIFF) && has(RIFF_FORMAT_AT, WEBP) -> "image/webp"
        else -> null
    }
}
