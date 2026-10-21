package com.sharpeyes.backend.invites

import com.sharpeyes.backend.bosses.clearSkipsOfSeats
import com.sharpeyes.backend.bosses.partySeatsChanged
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.users.activeWorldFor
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Turns a frozen payload into rows on the accepting account, and links the two accounts while both
// are in reach. Everything here runs in the caller's transaction, which is what makes a failure
// leave nothing behind: no half-built account, and the link still unspent to try again with.

/**
 * Writes [payload] onto [userId]'s account.
 *
 * The account need NOT be empty. It had to be until the mirror was unwound: accepting used to copy
 * the sender's configs onto your account, and merging those meant guessing whether the Pinewick
 * in the payload was the one already here. Since V75 accepting binds a seat on the sender's own row
 * instead, so the only thing that can overlap is a character or a person, and both of those are
 * matched by NAME, which is the match the rest of the app already runs on.
 *
 * Refusing a non-empty account was the worst screen in the app: it turned up only after the person
 * pressed the button, and it hit exactly the people keen enough to have signed up and added a
 * character before clicking the link.
 *
 * Assumes the payload's version has been checked. Returns what it did, including the configs it
 * could not, which the caller shows.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun acceptInvite(
    payload: InvitePayload,
    userId: String,
    /**
     * The character names the recipient confirmed are theirs, or null for all of them.
     *
     * The one thing on a link that has to be right. These names are the SENDER'S spelling of your
     * characters, so one taken by mistake is a character on your account you never added, a seat
     * bound to it, nights you were not on, and a figure in your Drop Log for a share you are not
     * owed. Everything else a link carries is either yours to edit afterwards or costs nothing.
     */
    confirmed: List<String>?,
    invitePersonId: Uuid,
    now: Instant,
): AcceptedInvite {
    // Matched the way every character name in this app is matched. A name the payload does not
    // carry is ignored rather than refused: the client sends back a subset of what it was shown.
    val taken =
        confirmed?.mapTo(mutableSetOf()) { it.lowercase() }?.let { wanted ->
            payload.copy(characters = payload.characters.filter { it.name.lowercase() in wanted })
        } ?: payload
    // Only where nobody has been asked. An account that has already chosen a world is not overruled
    // by somebody else's link: see V74, and the toggle is one click if the link is for the other.
    if (activeWorldFor(userId) == null) {
        Users.update({ Users.id eq userId }) { it[worldType] = payload.worldType }
    }

    // `taken` for the characters and the seats they bind, `payload` for everything else: the people
    // list and the account link are not narrowed by which characters somebody ticked.
    val characterIds = ensureCharacters(taken, userId, now)
    ensurePeople(payload, userId, now)
    val seated = takeSeats(taken, characterIds)

    linkAccounts(payload, userId, invitePersonId, now)

    return AcceptedInvite(
        charactersCreated = characterIds.size,
        peopleCreated = payload.people.size,
        partiesCreated = seated,
        omitted = payload.omitted,
    )
}

/**
 * The recipient's own characters, in the order the sender listed them.
 *
 * The sprite is copied and `sprite_checked_at` left null, so the daily refresh treats each one as
 * never asked and looks it up properly. The copy is what the roster draws in the meantime: the
 * cache is content-addressed on the URL, so these bytes are already warm and the alternative is a
 * new account whose every seat is blank until a job runs.
 */
private fun ensureCharacters(
    payload: InvitePayload,
    userId: String,
    now: Instant,
): Map<String, Uuid> {
    // By name AND world. A name is unique within a world and not across them, so the same name in
    // the other world is a different character and gets a row of its own rather than being bound to
    // by mistake. There is no unique index on characters(user_id, name) to catch that for us: a
    // duplicate would insert silently and leave ownCharacterIds picking one of the two arbitrarily.
    val existing =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .associate { (it[Characters.name].lowercase() to it[Characters.worldType]) to it[Characters.id] }

    // position is dense and the count is the next free slot, so an account that already has
    // characters appends rather than restarting at zero and stacking two on every square.
    var next = existing.size

    return payload.characters.associate { character ->
        val key = character.name.lowercase()
        val found = existing[key to character.worldType]
        if (found != null) {
            key to found
        } else {
            val id = Uuid.random()
            val sprite = payload.sprites[character.name]
            Characters.insert {
                it[Characters.id] = id
                it[Characters.userId] = userId
                it[name] = character.name
                it[worldType] = character.worldType
                it[spriteImgUrl] = sprite
                it[spriteRefreshedAt] = if (sprite != null) now else null
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = next++
            }
            key to id
        }
    }
}

/**
 * The payload's people, added to whoever this account already knows.
 *
 * A person already on the list is REUSED rather than inserted again: person has a unique constraint
 * on (user_id, name), so a second row is a 500 rather than a duplicate, and that is the constraint
 * doing its job.
 *
 * An attribution this account has already made for a character is left alone, whoever it named.
 * Their address book is theirs, and a link is somebody else's copy of part of it: moving a character
 * from the person they filed it under to the one the sender did would be guessing which of two
 * people is right about a third. Skipping is the same refusal validatePeople makes when two people
 * claim one character.
 */
private fun ensurePeople(
    payload: InvitePayload,
    userId: String,
    now: Instant,
) {
    val existing =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .associate { it[Person.name] to it[Person.id] }
    val claimed =
        PersonCharacter
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .mapTo(mutableSetOf()) { it[PersonCharacter.name].lowercase() }

    for (person in payload.people) {
        val personId =
            existing[person.name] ?: Uuid.random().also { id ->
                Person.insert {
                    it[Person.id] = id
                    it[Person.userId] = userId
                    it[name] = person.name
                    it[createdAt] = now
                    it[updatedAt] = now
                }
            }
        for (character in person.characters) {
            if (claimed.add(character.lowercase())) {
                PersonCharacter.insert {
                    it[PersonCharacter.id] = Uuid.random()
                    it[PersonCharacter.personId] = personId
                    it[PersonCharacter.userId] = userId
                    it[name] = character
                }
            }
        }
    }
}

/**
 * The recipient's seats in the sender's configs, bound to the characters just written.
 *
 * This is what accepting an invite DOES to the parties now, and it writes nothing new: the config
 * already has a seat with this character's name on it, because that is what made the payload
 * include it. Binding it says the seat is that account's character, which is the whole of their
 * membership. Returns how many configs they are now seated in.
 *
 * It used to copy each config onto the recipient's account and pair the two with party.group_id.
 * Two rows describing one party is two pools for one night, and worse, two `difficulty` columns
 * that can disagree about a mode the piece counts are joined on (V69, and #548 is what that costs).
 * So there is one row, and it stays the sender's. See V75.
 *
 * The sender's rows are written from the recipient's transaction, which is the sender's own doing:
 * issuing the link is what says these seats are this person's.
 */
private fun takeSeats(
    payload: InvitePayload,
    characterIds: Map<String, Uuid>,
): Int {
    var seated = 0
    for (party in payload.parties) {
        // Only a config the sender still owns. One deleted since the link was made leaves nothing
        // to sit in, which is what an expired invitation looks like anyway.
        val sourceId = Uuid.parseOrNull(party.sourcePartyId)
        val owned =
            sourceId != null &&
                Party
                    .selectAll()
                    .where { (Party.id eq sourceId) and (Party.userId eq payload.senderUserId) }
                    .empty()
                    .not()
        if (owned && bindSeats(sourceId, party.members + party.ownName, characterIds)) seated++
    }
    return seated
}

/**
 * Binds the seats of [sourceId] that name one of [characterIds], and says whether any did.
 *
 * Never a seat the config's owner already holds a character for: characterId is theirs, and V75
 * states in SQL that a seat cannot be both.
 */
private fun bindSeats(
    sourceId: Uuid,
    names: List<String>,
    characterIds: Map<String, Uuid>,
): Boolean {
    var bound = false
    for (name in names) {
        val characterId = characterIds[name.lowercase()]
        if (characterId != null) {
            val changed =
                PartyMember.update({
                    (PartyMember.partyId eq sourceId) and
                        (PartyMember.name.lowerCase() eq name.lowercase()) and
                        PartyMember.characterId.isNull()
                }) { it[linkedCharacterId] = characterId }
            if (changed > 0) bound = true
        }
    }
    if (bound) {
        clearSkipsOfSeats(sourceId)
        partySeatsChanged(sourceId, Clock.System.now())
    }
    return bound
}

/**
 * Records that these two accounts are two people, from both sides.
 *
 * Written here and nowhere else. This is the one moment both accounts are known at once: afterwards
 * the sender's Owen and Owen's account are joined only by character names, which cannot tell a shared
 * party from two people who happen to know the same name.
 */
private fun linkAccounts(
    payload: InvitePayload,
    userId: String,
    invitePersonId: Uuid,
    now: Instant,
) {
    Person.update({ Person.id eq invitePersonId }) {
        it[linkedUserId] = userId
        it[updatedAt] = now
    }
    val senderName = payload.people.firstOrNull { it.isSender }?.name ?: return
    Person.update({ (Person.userId eq userId) and (Person.name eq senderName) }) {
        it[linkedUserId] = payload.senderUserId
        it[updatedAt] = now
    }
}
