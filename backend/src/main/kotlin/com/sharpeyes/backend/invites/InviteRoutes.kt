package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.AccountInvite
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

// A link that starts somebody else's account from your side of the parties you share. Three
// audiences, and they are not the same person: the sender makes links, anybody holding one can see
// what it offers, and the recipient redeems it once signed in.
//
// Nothing here takes a link back. It expires on its own (INVITE_LIFETIME), and making a new one for
// somebody deletes the one it replaces, which between them are the two ways a link stops working.

/** Strict on purpose. A stored payload with a field we do not know is one to refuse, not to guess at. */
private val payloadJson = Json

fun Route.inviteRoutes() {
    get { listInvitesRoute() }
    post { createInviteRoute() }
    post("/{token}/accept") { acceptInviteRoute() }
}

/**
 * What one link offers, to somebody not signed in.
 *
 * Mounted outside the authenticated block, because the whole point is to be readable before there
 * is an account: a landing page that demanded a sign-in first would ask people to create an account
 * to find out whether they want one. The token is the authority, and it is the only one.
 */
fun Route.joinRoutes() {
    route("/api/join") {
        get("/{token}") { previewInviteRoute() }
    }
}

private suspend fun RoutingContext.listInvitesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val invites =
        dbQuery {
            ensureUser(userId, email)
            AccountInvite
                .join(Person, JoinType.INNER, AccountInvite.personId, Person.id)
                .selectAll()
                .where { AccountInvite.userId eq userId }
                .orderBy(AccountInvite.createdAt to SortOrder.DESC)
                .map { it.toInviteResponse(token = null) }
        }
    call.respond(invites)
}

/**
 * Makes a link for one person.
 *
 * The token comes back once, here, and is never recoverable: only its hash is stored. Any earlier
 * unaccepted link for the same person is deleted first, so "invite" is one live link per person
 * rather than a pile of them that all still work.
 */
private suspend fun RoutingContext.createInviteRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<CreateInviteRequest>()
    val personId = Uuid.parseOrNull(request.personId)

    if (personId == null) {
        call.respond(HttpStatusCode.BadRequest, "malformed personId")
        return
    }

    val now = Clock.System.now()
    val token = newInviteToken()
    val created =
        dbQuery {
            ensureUser(userId, email)
            // Derived, never sent: the client does not tell the server the user's own name.
            val senderName = senderNameFor(userId) ?: return@dbQuery null
            val payload = buildInvitePayload(userId, personId, senderName) ?: return@dbQuery null

            AccountInvite.deleteWhere {
                (AccountInvite.userId eq userId) and
                    (AccountInvite.personId eq personId) and
                    (AccountInvite.acceptedAt eq null)
            }

            val id = Uuid.random()
            AccountInvite.insert {
                it[AccountInvite.id] = id
                it[AccountInvite.userId] = userId
                it[AccountInvite.personId] = personId
                it[tokenHash] = hashInviteToken(token)
                it[AccountInvite.senderName] = senderName
                it[AccountInvite.payload] = payloadJson.encodeToJsonElement(payload)
                it[createdAt] = now
                it[expiresAt] = now + INVITE_LIFETIME
            }
            AccountInvite
                .join(Person, JoinType.INNER, AccountInvite.personId, Person.id)
                .selectAll()
                .where { AccountInvite.id eq id }
                .single()
                .toInviteResponse(token)
        }

    if (created == null) {
        call.respond(HttpStatusCode.NotFound, "no such person, or no character to send the link as")
    } else {
        call.respond(HttpStatusCode.Created, created)
    }
}

/**
 * A link's configs, as its landing page names them.
 *
 * The key itself where this build does not know the boss, which is a link made against a newer
 * catalog. Unreadable beats absent: the count is what the page leans on, and a missing row would
 * understate it.
 *
 * Named arguments because all three read as strings, so a transposition would compile.
 */
internal fun partyLabels(
    parties: List<InviteParty>,
    bossNames: Map<String, String>,
): List<InvitePartyLabel> =
    parties.map {
        InvitePartyLabel(
            bossName = bossNames[it.bossKey] ?: it.bossKey,
            difficulty = it.difficulty,
            characterName = it.ownName,
        )
    }

private suspend fun RoutingContext.previewInviteRoute() {
    val token = call.parameters["token"].orEmpty()
    val preview =
        dbQuery {
            val payload = liveInviteFor(token)?.second ?: return@dbQuery null
            val bossNames =
                BossCatalog
                    .selectAll()
                    .associate { it[BossCatalog.bossKey] to it[BossCatalog.name] }
            InvitePreview(
                senderName = payload.senderName,
                characters = payload.characters.map { it.name },
                parties = partyLabels(payload.parties, bossNames),
                peopleCount = payload.people.size,
                omitted = payload.omitted,
            )
        }
    if (preview == null) call.respond(HttpStatusCode.NotFound) else call.respond(preview)
}

/**
 * Redeems a link into the signed-in account, for the characters the recipient confirmed are theirs.
 *
 * A body naming none of them is refused rather than obeyed. It would spend the token and write
 * nothing, and a link that reports success having done nothing is the worst of both.
 *
 * The account itself need not be empty: acceptInvite binds a character it already has rather than
 * making a second one.
 */
private suspend fun RoutingContext.acceptInviteRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val token = call.parameters["token"].orEmpty()
    val now = Clock.System.now()
    // Absent is every character in the payload, which is what a client that does not ask sends.
    val confirmed = call.receiveNullable<AcceptInviteRequest>()?.characters

    val outcome =
        dbQuery {
            ensureUser(userId, email)
            val (invite, payload) = liveInviteFor(token) ?: return@dbQuery Refusal.Unknown
            if (payload.version != INVITE_PAYLOAD_VERSION) return@dbQuery Refusal.Stale
            // Redeeming your own link would link an account to itself and copy its parties back
            // onto it under different ids.
            if (invite[AccountInvite.userId] == userId) return@dbQuery Refusal.Own
            // Nothing to take is not the same as nothing to give: the link is left unspent so the
            // same one still works once they know which of these characters is theirs.
            if (confirmed != null && confirmed.isEmpty()) return@dbQuery Refusal.NothingTaken

            // Spent before the rows are written, inside the same transaction: two requests racing
            // the same link both pass the checks above, and the unique token_hash does not stop the
            // second because it is an update, not an insert. This does, by matching only the row
            // that is still unaccepted.
            val spent =
                AccountInvite.update({
                    (AccountInvite.id eq invite[AccountInvite.id]) and (AccountInvite.acceptedAt eq null)
                }) {
                    it[acceptedAt] = now
                    it[acceptedBy] = userId
                } > 0
            if (!spent) return@dbQuery Refusal.Unknown

            acceptInvite(payload, userId, confirmed, invite[AccountInvite.personId], now)
        }

    when (outcome) {
        Refusal.Unknown -> call.respond(HttpStatusCode.NotFound)
        Refusal.Stale -> call.respond(HttpStatusCode.Gone, "this link is out of date, ask for a new one")
        Refusal.Own -> call.respond(HttpStatusCode.Conflict, "this is your own link")
        Refusal.NothingTaken ->
            call.respond(HttpStatusCode.BadRequest, "tick at least one character that is yours")
        is AcceptedInvite -> call.respond(outcome)
        else -> call.respond(HttpStatusCode.NotFound)
    }
}

/** Why a link was not redeemed. One type so the transaction can return either it or the result. */
private enum class Refusal { Unknown, Stale, Own, NothingTaken }

/**
 * The invite a token names, if it is still good, with its payload read out.
 *
 * Unknown, expired and already accepted are one answer on purpose: three that a caller holding a
 * token could tell apart would say whether a token ever existed.
 *
 * Must be called from inside a `transaction { }` block.
 */
private fun liveInviteFor(token: String): Pair<ResultRow, InvitePayload>? {
    if (token.isEmpty()) return null
    return AccountInvite
        .selectAll()
        .where { AccountInvite.tokenHash eq hashInviteToken(token) }
        .firstOrNull()
        ?.takeIf { it[AccountInvite.acceptedAt] == null }
        ?.takeIf { it[AccountInvite.expiresAt] >= Clock.System.now() }
        ?.let { it to payloadJson.decodeFromJsonElement(it[AccountInvite.payload]) }
}

private fun ResultRow.toInviteResponse(token: String?): InviteResponse {
    val payload: InvitePayload = payloadJson.decodeFromJsonElement(this[AccountInvite.payload])
    return InviteResponse(
        id = this[AccountInvite.id].toString(),
        personId = this[AccountInvite.personId].toString(),
        personName = this[Person.name],
        senderName = this[AccountInvite.senderName],
        token = token,
        createdAt = this[AccountInvite.createdAt].toString(),
        expiresAt = this[AccountInvite.expiresAt].toString(),
        accepted = this[AccountInvite.acceptedAt] != null,
        characterCount = payload.characters.size,
        partyCount = payload.parties.size,
        omitted = payload.omitted,
    )
}
