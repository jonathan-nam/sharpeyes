package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.invites.senderNameFor
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What an unlink leaves each side: a copy of everything the two of them shared, theirs to keep
// editing. Before this, the member lost every shared party, drop and settlement the moment the seats
// were revoked, and the owner's card lost the characters only the link had attributed.
//
// READ BOTH BOOKS, THEN WRITE. Two directions run (each side's parties seating the other), and the
// second must not read the rows the first just copied in, or the money comes straight back doubled.
// Inside the unlink's transaction, so a failure leaves the link and both books as they were.

/** One direction: [bookOwner]'s parties and money that [reader] reaches through the link. */
internal class SharedSlice(
    val bookOwner: String,
    val reader: String,
    /** [bookOwner]'s person for [reader]: who the money is filed under. Null when they have none. */
    val ownerPerson: Uuid?,
    /** Parties of [bookOwner]'s with a seat bound to one of [reader]'s characters. */
    val parties: List<Uuid>,
    /**
     * Each of those parties' drops as they stood when read. The other direction's copy can merge
     * drops INTO one of these parties first, and copying those back would hand a side its own drops.
     */
    val loot: Map<Uuid, List<Uuid>>,
    val money: SharedMoney,
)

/** Reads what [reader] reaches in [bookOwner]'s book. Writes nothing. */
internal fun sliceOf(
    bookOwner: String,
    reader: String,
): SharedSlice {
    val readerCharacters = charactersOf(reader)
    val parties =
        if (readerCharacters.isEmpty()) {
            emptyList()
        } else {
            PartyMember
                .innerJoin(Party)
                .selectAll()
                .where { (Party.userId eq bookOwner) and (PartyMember.linkedCharacterId inList readerCharacters) }
                .map { it[Party.id] }
                .distinct()
        }
    val person = linkedPersonOf(bookOwner, reader)
    val loot =
        PartyLoot
            .selectAll()
            .where { PartyLoot.partyId inList parties }
            .groupBy({ it[PartyLoot.partyId] }) { it[PartyLoot.id] }
    return SharedSlice(bookOwner, reader, person, parties, loot, readMoney(bookOwner, person))
}

/** Writes [slice] into its reader's book. See the file comment for why reading came first. */
internal fun writeSnapshot(
    slice: SharedSlice,
    now: Instant,
) {
    keepAttribution(slice.bookOwner, slice.ownerPerson, seatedNames(slice.parties, charactersOf(slice.reader)))
    keepClears(slice.parties, charactersOf(slice.reader))
    if (slice.parties.isEmpty() && slice.money.isEmpty()) return

    val readerPerson = linkedPersonOf(slice.reader, slice.bookOwner) ?: newPerson(slice.reader, slice.bookOwner, now)
    val copies = slice.parties.mapNotNull { copyParty(it, slice.loot[it].orEmpty(), slice.reader, now) }
    keepAttribution(slice.reader, readerPerson, ownerSeatNames(slice.parties))
    val loot = copies.fold(emptyMap<Uuid, Uuid>()) { acc, copy -> acc + copyLoot(copy, now) }
    writeMoney(slice.money, slice.reader, readerPerson, loot, now)
}

/** [userId]'s characters, every world: a seat binds a character whichever world it is in. */
internal fun charactersOf(userId: String): List<Uuid> =
    Characters.selectAll().where { Characters.userId eq userId }.map { it[Characters.id] }

/** [userId]'s person whose account is [account], if they have one. */
private fun linkedPersonOf(
    userId: String,
    account: String,
): Uuid? =
    Person
        .selectAll()
        .where { (Person.userId eq userId) and (Person.linkedUserId eq account) }
        .orderBy(Person.createdAt)
        .firstOrNull()
        ?.get(Person.id)

/** A person for [account] on [userId]'s list, named as the invite flow names a sender. */
private fun newPerson(
    userId: String,
    account: String,
    now: Instant,
): Uuid {
    val id = Uuid.random()
    Person.insert {
        it[Person.id] = id
        it[Person.userId] = userId
        it[name] = senderNameFor(account) ?: "Party owner"
        it[pinned] = false
        it[linkedUserId] = null
        it[createdAt] = now
        it[updatedAt] = now
    }
    return id
}

/** The names [readerCharacters] are seated under in [parties]. */
private fun seatedNames(
    parties: List<Uuid>,
    readerCharacters: List<Uuid>,
): List<String> =
    if (parties.isEmpty() || readerCharacters.isEmpty()) {
        emptyList()
    } else {
        PartyMember
            .selectAll()
            .where { (PartyMember.partyId inList parties) and (PartyMember.linkedCharacterId inList readerCharacters) }
            .map { it[PartyMember.name] }
    }

/** The book owner's own characters seated in [parties] (a seat with a character id), by name. */
private fun ownerSeatNames(parties: List<Uuid>): List<String> =
    if (parties.isEmpty()) {
        emptyList()
    } else {
        PartyMember
            .selectAll()
            .where { PartyMember.partyId inList parties }
            .filter { it[PartyMember.characterId] != null }
            .map { it[PartyMember.name] }
    }

/**
 * Files [names] under [person] by hand, so they stay theirs once the link no longer says so.
 *
 * A linked person's characters come off their account (PersonResponse.ownedCharacters), and that is
 * gone the moment the link is. Without this the drop shares behind a card move to a card per
 * character, away from the debts and payments filed under the person. A name somebody else on the
 * list already claims is left with them: one name, one person (validatePeople).
 */
private fun keepAttribution(
    userId: String,
    person: Uuid?,
    names: List<String>,
) {
    if (person == null || names.isEmpty()) return
    val claimed =
        PersonCharacter
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .mapTo(mutableSetOf()) { it[PersonCharacter.name].lowercase() }
    for (name in names.distinctBy { it.lowercase() }) {
        if (name.lowercase() in claimed) continue
        PersonCharacter.insert {
            it[id] = Uuid.random()
            it[personId] = person
            it[PersonCharacter.userId] = userId
            it[PersonCharacter.name] = name
        }
        claimed += name.lowercase()
    }
}

/**
 * The reader's copies of the owner's clears, made their own. Revoking the seats re-reads the live
 * period and takes its copies back (see ClearWriteThrough), so this runs first and leaves nothing
 * marked as a copy for it to find.
 */
private fun keepClears(
    parties: List<Uuid>,
    readerCharacters: List<Uuid>,
) {
    if (parties.isEmpty() || readerCharacters.isEmpty()) return
    BossClear.update({ (BossClear.viaPartyId inList parties) and (BossClear.characterId inList readerCharacters) }) {
        it[viaPartyId] = null
    }
}
