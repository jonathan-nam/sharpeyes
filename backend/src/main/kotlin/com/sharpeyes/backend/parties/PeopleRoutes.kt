package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock

// Who plays which character. Separate from the configs on purpose: a config names characters, and
// this says whose they are, once, for every config that names them.

fun Route.peopleRoutes() {
    get { listPeople() }
    put { savePeopleRoute() }
    put("/{personId}/pinned") { pinPersonRoute() }
    // Taking back the account behind a person, and their seats with it. See UnlinkPerson.kt.
    delete("/{personId}/link") { unlinkPersonRoute() }
}

/** DELETE /api/people/{personId}/link. Idempotent: unlinking an unlinked person is a success. */
private suspend fun RoutingContext.unlinkPersonRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val personId = call.parseUuidParam("personId") ?: return

    val people =
        dbQuery {
            ensureUser(userId, email)
            if (unlinkPerson(userId, personId)) peopleFor(userId) else null
        }
    if (people == null) call.respond(HttpStatusCode.NotFound) else call.respond(people)
}

private suspend fun RoutingContext.listPeople() {
    val (userId, email) = call.principalIdAndEmail()
    val people =
        dbQuery {
            ensureUser(userId, email)
            peopleFor(userId)
        }
    call.respond(people)
}

private suspend fun RoutingContext.savePeopleRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePeopleRequest>()

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val problem = validatePeople(request)
            if (problem != null) {
                problem
            } else {
                savePeople(userId, request, Clock.System.now())
                peopleFor(userId)
            }
        }
    when (outcome) {
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        else -> call.respond(outcome)
    }
}

/**
 * Why this people list cannot be saved, or null.
 *
 * A character belongs to one person: the game's names are unique in a world, so two people
 * claiming the same one is a mistake, and letting it through would make "whose is this?" a
 * question with two answers.
 */
internal fun validatePeople(request: SavePeopleRequest): String? {
    val names = request.people.map { it.name.trim() }
    val characters =
        request.people
            .flatMap { person -> person.characters.map { it.trim() } }
            .filter { it.isNotEmpty() }
            .map { it.lowercase() }

    return when {
        names.any { it.isBlank() } -> "a person needs a name"
        names.map { it.lowercase() }.distinct().size != names.size -> "two people share a name"
        characters.distinct().size != characters.size -> "two people claim the same character"
        else -> null
    }
}

/**
 * Pins or unpins one person, so their Settlement Ledger card stays drawn. See V59.
 *
 * Its own path rather than a field on the bulk save: that rewrites the whole people list, and a pin
 * toggled from a card would have to send back every person and every character to set one boolean.
 */
private suspend fun RoutingContext.pinPersonRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val personId = call.parseUuidParam("personId") ?: return
    val request = call.receive<PinPersonRequest>()

    val people =
        dbQuery {
            ensureUser(userId, email)
            val changed =
                Person.update({ (Person.id eq personId) and (Person.userId eq userId) }) {
                    it[pinned] = request.pinned
                    it[updatedAt] = Clock.System.now()
                } > 0
            if (changed) peopleFor(userId) else null
        }
    if (people == null) call.respond(HttpStatusCode.NotFound) else call.respond(people)
}
