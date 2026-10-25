package com.sharpeyes.backend.pages

import com.sharpeyes.api.pages.DropLogPageResponse
import com.sharpeyes.api.pages.SharedPartiesResponse
import com.sharpeyes.backend.plugins.addSpan
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.span
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.money.DropLogPage
import com.sharpeyes.money.SharedBook
import com.sharpeyes.money.droplog.DropLogFigures
import com.sharpeyes.money.droplog.dropLogFigures
import com.sharpeyes.money.moneyJson
import io.ktor.http.ContentType
import io.ktor.server.application.call
import io.ktor.server.response.respondText
import io.ktor.server.routing.RoutingContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlin.time.measureTimedValue

// The Drop Log's money, worked out on the server by the shared module (shared/money) rather than in
// the browser. Read off the same two payloads the page reads, as the JSON the browser would receive,
// so both sides compute from one input. See docs/backend-arithmetic-plan.md, Phases 3 and 4.

/** How the page payloads are written for the money module: every field present, as served. */
private val served = Json { encodeDefaults = true }

/** The page and shared books as the money module reads them. Must be called inside a `transaction { }`. */
private fun moneyInputsFor(userId: String): Pair<DropLogPage, List<SharedBook>> {
    val page = served.encodeToJsonElement(DropLogPageResponse.serializer(), dropLogPageFor(userId))
    val books = served.encodeToJsonElement(ListSerializer(SharedPartiesResponse.serializer()), sharedBooksFor(userId))
    return moneyJson.decodeFromJsonElement(DropLogPage.serializer(), page) to
        moneyJson.decodeFromJsonElement(ListSerializer(SharedBook.serializer()), books)
}

/** The account's Drop Log figures. Must be called from inside a `transaction { }` block. */
internal fun dropLogFiguresFor(userId: String): DropLogFigures =
    moneyInputsFor(userId).let { (page, books) -> dropLogFigures(page, books) }

/**
 * GET /api/pages/drop-log/figures. Written with the money module's own JSON, Maps tagged in order.
 * Times `read`, `money` and `encode` apart (Server-Timing and the request's log line), and works the
 * money out after the transaction, so the connection is not held for it.
 */
internal suspend fun RoutingContext.dropLogFiguresPage() {
    val (userId, email) = call.principalIdAndEmail()
    val (page, books) =
        dbQuery {
            ensureUser(userId, email)
            val (inputs, read) = measureTimedValue { moneyInputsFor(userId) }
            call.addSpan("read", read)
            inputs
        }
    val (figures, money) = measureTimedValue { dropLogFigures(page, books) }
    call.addSpan("money", money)
    val body = call.span("encode") { moneyJson.encodeToString(DropLogFigures.serializer(), figures) }
    call.respondText(body, ContentType.Application.Json)
}
