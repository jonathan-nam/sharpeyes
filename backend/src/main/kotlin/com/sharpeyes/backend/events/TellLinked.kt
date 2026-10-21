package com.sharpeyes.backend.events

import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.plugins.dbQuery
import io.ktor.http.HttpMethod
import io.ktor.http.isSuccess
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.createRouteScopedPlugin
import io.ktor.server.application.hooks.ResponseSent
import io.ktor.server.auth.AuthenticationChecked
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.routing.Route
import io.ktor.util.AttributeKey
import kotlinx.coroutines.launch
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.selectAll

// The other half of live events, for writes that do not say which party they touched: the Settlement
// ledger, people, a party's configuration. Installed on a route group, it tells everybody linked to
// the caller (and the caller's other tabs) once any write there has gone through. Broader than a
// party's audience on purpose: between linked accounts a spare re-read costs nothing, and a missed
// one is a screen that is wrong. See Publish.kt for the per-write kind.

private val LINKED_BEFORE = AttributeKey<Set<String>>("linkedBefore")

/** Every account linked to [userId], whichever side wrote the link. Inside a transaction. */
internal fun linkedTo(userId: String): Set<String> =
    Person
        .selectAll()
        .where { (Person.userId eq userId) or (Person.linkedUserId eq userId) }
        .mapNotNull { if (it[Person.userId] == userId) it[Person.linkedUserId] else it[Person.userId] }
        .toSet()

/** Tells the caller's links that [topics] moved, after every successful write under this route. */
fun Route.tellLinkedOnWrite(vararg topics: String) {
    install(
        createRouteScopedPlugin("TellLinked") {
            // Not onCall, which runs before authentication has said who is calling, so it saw nobody
            // and the list was always empty: an unlink then told nobody at all.
            on(AuthenticationChecked) { call ->
                val user = call.writer() ?: return@on
                // Before the write too: an unlink or a removal takes the account it ends off the list.
                call.attributes.put(LINKED_BEFORE, dbQuery { linkedTo(user) })
            }
            on(ResponseSent) { call ->
                val user = call.writer() ?: return@on
                if (call.response.status()?.isSuccess() != true) return@on
                val before = call.attributes.getOrNull(LINKED_BEFORE).orEmpty()
                // After the response, so the write has committed before anybody reads it back.
                call.application.launch {
                    dbQuery {
                        val told = before + linkedTo(user) + user
                        topics.forEach { publish(told, it) }
                    }
                }
            }
        },
    )
}

private fun ApplicationCall.writer(): String? =
    if (request.local.method == HttpMethod.Get) null else principal<JWTPrincipal>()?.payload?.subject
