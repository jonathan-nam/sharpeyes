package com.sharpeyes.backend.invites

import com.sharpeyes.backend.bosses.clearSkipsOfSeats
import com.sharpeyes.backend.bosses.partySeatsChanged
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.parties.bossesRunInOwnParty
import com.sharpeyes.backend.parties.inPartyFor
import com.sharpeyes.backend.parties.linkedRosterFor
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Seats a character added after accepting an invite, in the parties of whoever sent it.
 *
 * Invite accept binds only the characters it was handed, so one added later sat unbound beside an
 * owner's seat that already named it. Only accounts linked to this one (person.linked_user_id), only
 * seats nobody holds, only standing parties, and only in the character's own world: a name can repeat
 * across worlds and those players cannot party. Inside a transaction, like the rest.
 */
internal fun seatInLinkedParties(
    userId: String,
    characterId: Uuid,
    name: String,
    worldType: String,
) {
    val owners =
        Person
            .selectAll()
            .where { Person.linkedUserId eq userId }
            .map { it[Person.userId] }
            .filter { it != userId }
    if (owners.isEmpty()) return
    // An owner who is also linked to another account holding this name cannot know which of the two
    // it is, so their seats are left for them to settle. See LinkedRoster.
    val clear = owners.filter { linkedRosterFor(it).soleCharacter(name) == characterId }
    if (clear.isEmpty()) return
    // Not a boss they already run in a party of their own: two pools for one night. See
    // StandingParties.kt.
    val ownBosses = bossesRunInOwnParty(userId, name)
    val parties =
        Party
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { (Party.userId inList clear) and (Characters.worldType eq worldType) and (Party.standing eq true) }
            .filter { it[Party.bossCatalogId] !in ownBosses }
            .map { it[Party.id] to it[Party.bossCatalogId] }
    for ((partyId, bossId) in parties) {
        // Nor a second party for one boss, a seat bound earlier in this loop included: a character
        // clears a boss once a period (V100).
        if (inPartyFor(characterId, bossId, partyId)) continue
        val bound =
            PartyMember.update({
                (PartyMember.partyId eq partyId) and
                    (PartyMember.name.lowerCase() eq name.lowercase()) and
                    PartyMember.characterId.isNull() and
                    PartyMember.linkedCharacterId.isNull()
            }) { it[linkedCharacterId] = characterId }
        if (bound > 0) {
            clearSkipsOfSeats(partyId)
            partySeatsChanged(partyId, Clock.System.now())
        }
    }
}
