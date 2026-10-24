package com.sharpeyes.backend.pages

import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.money.DropLogFigures
import com.sharpeyes.money.DropLogPage
import com.sharpeyes.money.SharedBook
import com.sharpeyes.money.dropLogFigures
import com.sharpeyes.money.moneyJson
import io.ktor.http.ContentType
import io.ktor.server.application.call
import io.ktor.server.response.respondText
import io.ktor.server.routing.RoutingContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

// The Drop Log's money, worked out on the server by the shared module (backend/money) rather than in
// the browser. Read off the same two payloads the page reads, as the JSON the browser would receive,
// so both sides compute from one input. See docs/backend-arithmetic-plan.md, Phases 3 and 4.

/** How the page payloads are written for the money module: every field present, as served. */
private val served = Json { encodeDefaults = true }

/** The account's Drop Log figures. Must be called from inside a `transaction { }` block. */
internal fun dropLogFiguresFor(userId: String): DropLogFigures {
    val page = served.encodeToJsonElement(DropLogPageResponse.serializer(), dropLogPageFor(userId))
    val books = served.encodeToJsonElement(ListSerializer(SharedBookResponse.serializer()), sharedBooksFor(userId))
    return dropLogFigures(
        moneyJson.decodeFromJsonElement(DropLogPage.serializer(), page),
        moneyJson.decodeFromJsonElement(ListSerializer(SharedBook.serializer()), books),
    )
}

/** GET /api/pages/drop-log/figures. Written with the money module's own JSON, Maps tagged in order. */
internal suspend fun RoutingContext.dropLogFiguresPage() {
    val (userId, email) = call.principalIdAndEmail()
    val figures =
        dbQuery {
            ensureUser(userId, email)
            dropLogFiguresFor(userId)
        }
    call.respondText(moneyJson.encodeToString(DropLogFigures.serializer(), figures), ContentType.Application.Json)
}
