package com.sharpeyes.backend.characters

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.span
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.sprites.SpriteCache
import com.sharpeyes.backend.users.activeWorldFor
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.inActiveWorld
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

fun Route.characterRoutes(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    post { createCharacter(nexonLookupService, spriteCache) }
    get { listCharacters() }
    // Registered BEFORE /{id}, or the parameter route swallows the literal.
    get("/tokens") { getAllCharacterTokens() }
    // Literal before /{id}, or the parameter route swallows it (same as /tokens above).
    put("/order") { reorderCharacters() }
    get("/{id}") { getCharacter() }
    put("/{id}") { updateCharacter() }
    post("/{id}/refresh") { refreshCharacter(nexonLookupService, spriteCache) }
    get("/{id}/tokens") { getCharacterTokens() }
    // Typing a count in. The only other writer of these rows is a screenshot parse.
    put("/{id}/tokens/{tokenId}") { setCharacterTokenCount() }
    delete("/{id}") { deleteCharacter() }
}

private suspend fun RoutingContext.createCharacter(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<CreateCharacterRequest>()
    if (request.name.isBlank()) {
        call.respond(HttpStatusCode.BadRequest, "name must not be blank")
        return
    }

    val lookup = call.span("nexon") { nexonLookupService.lookup(request.name) }
    // Before the transaction, not inside it: an outbound fetch holding a pooled connection ties it
    // up for as long as Nexon takes. A null here is fine, the route falls back to redirecting.
    val spriteBytes = lookup?.spriteImgUrl?.let { call.span("sprite") { spriteCache.fetch(it) } }
    val now = Clock.System.now()
    val newId = Uuid.random()

    val created =
        dbQuery {
            ensureUser(userId, email)
            // Append to the end of this user's carousel. position is dense, so the count is
            // the next free slot.
            val nextPosition =
                Characters
                    .selectAll()
                    .where { Characters.userId eq userId }
                    .count()
                    .toInt()
            // What the lookup FOUND, falling back to the world being shown when it found nothing.
            //
            // The lookup is evidence and the fallback is an assumption, so the evidence wins. It is
            // the difference between a character that is in the right world and one that is in the
            // world you happened to be looking at, and nothing downstream can tell those apart:
            // a wrong tick looks exactly like a right one, which is how six characters ended up
            // recorded in the wrong world with every screen agreeing.
            //
            // Nothing found is not nothing known: an unranked or misspelled name falls through to
            // manual entry, and the world you are in is the best answer available for it.
            val detected = lookup?.world
            // Neither the lookup nor the account can say which world this character is in, so
            // nothing here can. Placing them in a world picked for them is the failure the world
            // comment above describes, and V74 is what makes refusing possible: before it the
            // account always held a world, whether or not anyone had chosen it.
            val world = detected?.worldType ?: activeWorldFor(userId) ?: return@dbQuery null
            Characters.insert {
                it[id] = newId
                it[Characters.userId] = userId
                // Nexon's spelling, for the same reason as `detected`: the lookup matches
                // case-insensitively, so the typed name is a guess at the capitalisation and the
                // answer is not.
                it[name] = lookup?.name ?: request.name
                it[level] = lookup?.level
                it[jobName] = lookup?.jobName
                it[worldName] = detected?.displayName
                it[worldType] = world
                it[spriteImgUrl] = lookup?.spriteImgUrl
                it[spriteRefreshedAt] = if (lookup != null) now else null
                // We asked, whatever came back. A name that resolved to nothing is not re-asked
                // until it comes due like everything else.
                it[spriteCheckedAt] = now
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = nextPosition
            }
            lookup?.spriteImgUrl?.let { spriteCache.store(it, spriteBytes) }
            findOwnedCharacter(newId, userId)
        }

    if (created == null) {
        call.respond(HttpStatusCode.Conflict, "choose a world before adding a character")
        return
    }
    call.respond(HttpStatusCode.Created, created)
}

private suspend fun RoutingContext.listCharacters() {
    val (userId, email) = call.principalIdAndEmail()
    val characters =
        dbQuery {
            ensureUser(userId, email)
            charactersInActiveWorld(userId)
        }
    call.respond(characters)
}

/** This account's characters in the world it is looking at, in carousel order. */
internal fun charactersInActiveWorld(userId: String): List<CharacterResponse> =
    Characters
        .selectAll()
        .where { (Characters.userId eq userId) and inActiveWorld(userId) }
        .orderBy(Characters.position)
        .map { it.toCharacterResponse() }

private suspend fun RoutingContext.reorderCharacters() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<ReorderCharactersRequest>()

    val parsed = request.orderedIds.map { runCatching { Uuid.parse(it) }.getOrNull() }
    if (parsed.any { it == null }) {
        call.respond(HttpStatusCode.BadRequest, "orderedIds contains an invalid id")
        return
    }
    val order = parsed.filterNotNull()

    val reordered =
        dbQuery {
            ensureUser(userId, email)
            // The world being shown, because that is the list the caller was looking at. It cannot
            // name a character it was never sent, and requiring the whole account would refuse
            // every reorder made while a world is toggled on.
            val shown =
                Characters
                    .selectAll()
                    .where {
                        (Characters.userId eq userId) and inActiveWorld(userId)
                    }.orderBy(Characters.position)
                    .map { it[Characters.id] to it[Characters.position] }
            // Must be exactly that set, no missing, extra or duplicate ids, or position would end
            // up with holes or collisions.
            if (order.size != shown.size || order.toSet() != shown.map { it.first }.toSet()) {
                return@dbQuery null
            }
            // Permute the slots these characters already hold rather than numbering from zero. The
            // other world's characters keep theirs, so position stays dense across the account and
            // their order survives a reorder they were not part of.
            val slots = shown.map { it.second }.sorted()
            order.forEachIndexed { index, characterId ->
                Characters.update({ (Characters.id eq characterId) and (Characters.userId eq userId) }) {
                    it[position] = slots[index]
                }
            }
            charactersInActiveWorld(userId)
        }

    if (reordered == null) {
        call.respond(HttpStatusCode.BadRequest, "orderedIds must be exactly your characters, once each")
    } else {
        call.respond(reordered)
    }
}

private suspend fun RoutingContext.getCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val character =
        dbQuery {
            ensureUser(userId, email)
            findOwnedCharacter(characterId, userId)
        }
    respondFoundOrNotFound(character)
}

private suspend fun RoutingContext.updateCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return
    val request = call.receive<UpdateCharacterRequest>()

    val updated =
        dbQuery {
            ensureUser(userId, email)
            val rowsChanged =
                Characters.update({ (Characters.id eq characterId) and (Characters.userId eq userId) }) { row ->
                    request.name?.let { row[Characters.name] = it }
                    request.level?.let { row[Characters.level] = it }
                    row[Characters.updatedAt] = Clock.System.now()
                }
            if (rowsChanged == 0) null else findOwnedCharacter(characterId, userId)
        }
    respondFoundOrNotFound(updated)
}

private suspend fun RoutingContext.refreshCharacter(
    nexonLookupService: NexonLookupService,
    spriteCache: SpriteCache,
) {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val existingName =
        dbQuery {
            ensureUser(userId, email)
            findOwnedCharacter(characterId, userId)?.name
        }
    if (existingName == null) {
        call.respond(HttpStatusCode.NotFound)
        return
    }

    val lookup = call.span("nexon") { nexonLookupService.lookup(existingName) }
    val spriteBytes = lookup?.spriteImgUrl?.let { call.span("sprite") { spriteCache.fetch(it) } }
    val refreshed =
        dbQuery {
            // A transient lookup failure leaves existing level/job/sprite untouched rather than
            // nulling out previously-good data.
            if (lookup != null) {
                applyLookup(characterId, userId, lookup, Clock.System.now())
                spriteCache.store(lookup.spriteImgUrl, spriteBytes)
            }
            findOwnedCharacter(characterId, userId)
        }
    call.respond(refreshed!!)
}

private suspend fun RoutingContext.deleteCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val rowsDeleted =
        dbQuery {
            ensureUser(userId, email)
            Characters.deleteWhere { (Characters.id eq characterId) and (Characters.userId eq userId) }
        }
    if (rowsDeleted == 0) {
        call.respond(HttpStatusCode.NotFound)
    } else {
        call.respond(HttpStatusCode.NoContent)
    }
}

private suspend fun RoutingContext.respondFoundOrNotFound(character: CharacterResponse?) {
    if (character == null) {
        call.respond(HttpStatusCode.NotFound)
    } else {
        call.respond(character)
    }
}
