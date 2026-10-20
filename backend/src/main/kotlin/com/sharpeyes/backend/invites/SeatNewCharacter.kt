package com.sharpeyes.backend.invites

import com.sharpeyes.backend.bosses.clearSkipsOfSeats
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

/**
 * Seats a character added after accepting an invite, in the parties of whoever sent it.
 *
 * Invite accept binds only the characters it was handed, so one added later sat unbound beside an
 * owner's seat that already named it. Only accounts linked to this one (person.linked_user_id), only
 * seats nobody holds, and only parties in the character's own world: a name can repeat across
 * worlds and those players cannot party. Inside a transaction, like the rest.
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
    val parties =
        Party
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { (Party.userId inList owners) and (Characters.worldType eq worldType) }
            .map { it[Party.id] }
    for (partyId in parties) {
        val bound =
            PartyMember.update({
                (PartyMember.partyId eq partyId) and
                    (PartyMember.name.lowerCase() eq name.lowercase()) and
                    PartyMember.characterId.isNull() and
                    PartyMember.linkedCharacterId.isNull()
            }) { it[linkedCharacterId] = characterId }
        if (bound > 0) clearSkipsOfSeats(partyId)
    }
}
