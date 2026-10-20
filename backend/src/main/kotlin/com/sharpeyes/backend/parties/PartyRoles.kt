package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyRole
import com.sharpeyes.backend.plugins.Refusal
import com.sharpeyes.backend.plugins.dbQuery
import com.sharpeyes.backend.plugins.failing
import com.sharpeyes.backend.plugins.parseUuidParam
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.plugins.refuse
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What each account may do in a party: its owner, a member who may record, or a member who reads.
//
// Recording follows whoever holds the loot, and that moves with the debt between two people, so it
// cannot be ownership. See docs/shared-parties-plan.md. All inside a transaction, like the rest.

const val ROLE_OWNER = "OWNER"
const val ROLE_EDITOR = "EDITOR"
const val ROLE_VIEWER = "VIEWER"

/**
 * [userId]'s role in [partyId], or null when they cannot reach it at all.
 *
 * A stored Editor row only counts while they still hold a standing seat. Leaving and unlinking
 * delete it too, but the seat is what grants access, so the row alone must never be a way in.
 */
internal fun roleIn(
    partyId: Uuid,
    userId: String,
): String? =
    when {
        ownsParty(partyId, userId) -> ROLE_OWNER
        !isSeatedIn(partyId, userId) -> null
        else -> storedRoles(listOf(partyId))[partyId to userId] ?: ROLE_VIEWER
    }

/** True when [userId] may write into [partyId]'s pool: its owner, or an Editor seated in it. */
internal fun canEditParty(
    partyId: Uuid,
    userId: String,
): Boolean = roleIn(partyId, userId).let { it == ROLE_OWNER || it == ROLE_EDITOR }

/** [userId]'s standing seats in somebody else's [partyId]: the only seats an Editor may act as. */
internal fun mySeatsIn(
    partyId: Uuid,
    userId: String,
): Set<Uuid> =
    PartyMember
        .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
        .selectAll()
        .where {
            (PartyMember.partyId eq partyId) and
                (PartyMember.standing eq true) and
                (Characters.userId eq userId)
        }.map { it[PartyMember.id] }
        .toSet()

/**
 * Whether [userId] may act as seat [memberId] in [partyId]. The owner acts as anybody, the way every
 * write worked before roles; an Editor only as one of their own seats.
 */
internal fun mayActAs(
    partyId: Uuid,
    userId: String,
    memberId: Uuid?,
): Boolean = ownsParty(partyId, userId) || (memberId != null && memberId in mySeatsIn(partyId, userId))

/** [this] as a member who does not own it sees it: their role, and the seats they act as. */
internal fun PartyResponse.asMember(userId: String): PartyResponse {
    val partyId = Uuid.parse(id)
    return copy(
        yours = false,
        role = roleIn(partyId, userId) ?: ROLE_VIEWER,
        yourSeats = mySeatsIn(partyId, userId).map { it.toString() },
    )
}

/** Every stored role on [partyIds], by (party, account). Absent is a Viewer. */
internal fun storedRoles(partyIds: List<Uuid>): Map<Pair<Uuid, String>, String> =
    if (partyIds.isEmpty()) {
        emptyMap()
    } else {
        PartyRole
            .selectAll()
            .where { PartyRole.partyId inList partyIds }
            .associate { (it[PartyRole.partyId] to it[PartyRole.userId]) to it[PartyRole.role] }
    }

/** Takes [userId]'s role in [partyId] back to Viewer. What leaving a party does to it. */
internal fun dropRole(
    partyId: Uuid,
    userId: String,
) {
    PartyRole.deleteWhere { (PartyRole.partyId eq partyId) and (PartyRole.userId eq userId) }
}

/** Takes [account]'s roles off every party [userId] owns. What unlinking a person does to them. */
internal fun dropRolesOn(
    userId: String,
    account: String,
) {
    val mine = Party.selectAll().where { Party.userId eq userId }.map { it[Party.id] }
    if (mine.isNotEmpty()) {
        PartyRole.deleteWhere { (PartyRole.partyId inList mine) and (PartyRole.userId eq account) }
    }
}

@Serializable
data class SetRoleRequest(
    val role: String,
)

internal sealed interface RoleOutcome {
    data object Set : RoleOutcome

    data object NotFound : RoleOutcome

    data class Refused(
        val refusal: Refusal,
    ) : RoleOutcome
}

/**
 * Sets the role of the account behind seat [memberId] in [partyId]. The owner's act alone.
 *
 * Only a seat bound to somebody else's account has a role to set. A name nobody has claimed is
 * nobody who can sign in, and the owner's own seats are the owner.
 */
internal fun setMemberRole(
    ownerId: String,
    partyId: Uuid,
    memberId: Uuid,
    role: String,
    now: Instant,
): RoleOutcome {
    if (!ownsParty(partyId, ownerId)) return RoleOutcome.NotFound
    val account =
        PartyMember
            .join(Characters, JoinType.INNER, PartyMember.linkedCharacterId, Characters.id)
            .selectAll()
            .where { (PartyMember.id eq memberId) and (PartyMember.partyId eq partyId) }
            .firstOrNull()
            ?.get(Characters.userId)
    return when {
        role != ROLE_EDITOR && role != ROLE_VIEWER -> RoleOutcome.Refused(Refusal("Pick Viewer or Editor."))
        account == null -> RoleOutcome.Refused(Refusal("This member hasn't joined. Send them an invite."))
        else -> {
            if (role == ROLE_VIEWER) {
                dropRole(partyId, account)
            } else {
                PartyRole.upsert {
                    it[PartyRole.partyId] = partyId
                    it[userId] = account
                    it[PartyRole.role] = role
                    it[updatedAt] = now
                }
            }
            RoleOutcome.Set
        }
    }
}

/** PUT /api/parties/{id}/members/{memberId}/role. Answers with the party as the owner now sees it. */
internal suspend fun RoutingContext.setMemberRoleRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val memberId = call.parseUuidParam("memberId") ?: return
    val request = call.receive<SetRoleRequest>()
    val (outcome, party) =
        dbQuery {
            ensureUser(userId, email)
            val outcome = setMemberRole(userId, partyId, memberId, request.role, Clock.System.now())
            outcome to (if (outcome == RoleOutcome.Set) findParty(partyId, userId) else null)
        }
    when (outcome) {
        RoleOutcome.Set -> call.respond(party!!)
        RoleOutcome.NotFound -> call.respond(HttpStatusCode.NotFound)
        is RoleOutcome.Refused -> {
            call.failing(outcome.refusal.refusal)
            call.refuse(HttpStatusCode.Conflict, outcome.refusal)
        }
    }
}
