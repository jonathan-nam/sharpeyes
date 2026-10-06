package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.parties.seatSpritesByCharacter
import com.sharpeyes.backend.users.activeWorldFor
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Reads the sender's account and writes down what the other side of it looks like. Pure of the
// request: it takes a person and gives back the document, so what a link does is decided in one
// place and tested without a second account.

private data class SourceConfig(
    val partyId: Uuid,
    val bossKey: String,
    val difficulty: String?,
    val minutes: Int?,
    // The world the sender's own character plays in, which is the world the party is in.
    val worldType: String,
)

private data class SourceSeat(
    val id: Uuid,
    val name: String,
    val shares: Int,
)

/**
 * The account [personId] would have, seen from the sender's data, or null when that person is not
 * the caller's.
 *
 * Which configs travel: a standing arrangement (see standingConfigsOf) seating at least one
 * character the sender has attributed to this person. A config the recipient has no seat in is not
 * theirs to receive.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun buildInvitePayload(
    userId: String,
    personId: Uuid,
    senderName: String,
): InvitePayload? {
    val isTheirPerson =
        Person
            .selectAll()
            .where { (Person.id eq personId) and (Person.userId eq userId) }
            .firstOrNull() != null

    // Two ways to have nothing to send, refused together because detekt allows one early return.
    // The person is not the caller's, or the sender has never said which world they play in: every
    // config, character and seat below is read through that lens, and there is no lens (V74, and
    // see users/WorldType.kt). Refusing beats substituting a world, which would put an arrangement
    // the sender was never shown into the link.
    val world = activeWorldFor(userId)
    if (!isTheirPerson || world == null) return null

    val theirCharacters =
        PersonCharacter
            .selectAll()
            .where { (PersonCharacter.personId eq personId) and (PersonCharacter.userId eq userId) }
            .orderBy(PersonCharacter.name)
            .map { it[PersonCharacter.name] }
    val theirs = theirCharacters.map { it.lowercase() }.toSet()

    val configs = standingConfigsOf(userId)
    val seats = standingSeatsOf(configs.map { it.partyId })

    val (parties, omitted) = mirroredParties(configs, seats, theirs)

    // Every seat in the configs that travel, minus the recipient's own. These are the people the
    // recipient needs named, and the only ones this link is entitled to hand over.
    val seatNames = parties.flatMap { it.members }.distinctBy { it.lowercase() }

    return InvitePayload(
        version = INVITE_PAYLOAD_VERSION,
        senderName = senderName,
        senderUserId = userId,
        worldType = world,
        characters = recipientCharacters(theirCharacters, parties, configs, world),
        people = peopleIn(userId, senderName, seatNames),
        parties = parties,
        omitted = omitted,
        sprites = spritesFor(userId, theirCharacters + seatNames),
    )
}

/**
 * What a friend already knows the sender as: their main character, else the first in the carousel.
 *
 * Their in-game name, not their account's. `users` holds an email and an id, and neither is a thing
 * to put on somebody else's people list. Null only for an account with no characters at all, which
 * has no people to invite either.
 *
 * Derived rather than typed. The sender used to be asked, which turned a one-click action into a
 * form and needed a label to explain why the box was there. A wrong guess here costs nothing: the
 * recipient renames people on their own list like any other.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun senderNameFor(userId: String): String? {
    val main =
        Users
            .selectAll()
            .where { Users.id eq userId }
            .firstOrNull()
            ?.get(Users.mainCharacterId)
    val mine =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .orderBy(Characters.position)
            .toList()
    return mine.firstOrNull { it[Characters.id] == main }?.get(Characters.name)
        ?: mine.firstOrNull()?.get(Characters.name)
}

/**
 * Every config of the sender's that describes a standing arrangement somebody else is part of.
 *
 * Not solo, which has nobody else in it. Not retired, which is kept for the pool hanging off it.
 * And **not a one-off**, which is the one that is easy to miss: a one-off is a boss run once, on
 * for the periods it is armed for and off in every other, so it is not an arrangement to hand over.
 * Carrying one would create it on the recipient's account as a permanent config, which says
 * "CreedBratton runs Jupiter every week" on the strength of a single night in August.
 *
 * Found by dry-running this against real data: three of the sender's configs were spent one-offs,
 * and two of them collided with real configs and were reported as dropped, which made an artefact
 * of this bug look like a fact about the parties.
 */
private fun standingConfigsOf(userId: String): List<SourceConfig> =
    Party
        .join(BossCatalog, JoinType.INNER, Party.bossCatalogId, BossCatalog.id)
        .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
        .selectAll()
        .where {
            (Party.userId eq userId) and
                (Party.standing eq true) and
                (Party.solo eq false) and
                (Party.oneOff eq false)
        }.orderBy(Party.createdAt)
        .map {
            SourceConfig(
                partyId = it[Party.id],
                bossKey = it[BossCatalog.bossKey],
                difficulty = it[Party.difficulty],
                minutes = it[Party.minutes],
                worldType = it[Characters.worldType],
            )
        }

/**
 * The usual roster of each config, in seat order.
 *
 * Standing seats only. A guest sat in one week and a member who has since left are both history the
 * pool needs and neither is an answer to "who is in this party", which is what a new account is
 * being told.
 */
private fun standingSeatsOf(partyIds: List<Uuid>): Map<Uuid, List<SourceSeat>> {
    if (partyIds.isEmpty()) return emptyMap()
    return PartyMember
        .selectAll()
        .where { (PartyMember.partyId inList partyIds) and (PartyMember.standing eq true) }
        .orderBy(PartyMember.position)
        .groupBy({ it[PartyMember.partyId] }) {
            SourceSeat(it[PartyMember.id], it[PartyMember.name], it[PartyMember.shares])
        }
}

/**
 * Each config turned around, and the ones that could not be.
 *
 * A config becomes the recipient's when one of their characters sits in it, and that seat is what
 * it becomes a config OF. Bringing two of their own characters to one party is fine: the first by
 * seat order anchors it and the second stays an ordinary member, which is what the seat writer
 * does with a second character of yours anyway.
 *
 * One character runs one boss, so a second config seating the same character of theirs on the same
 * boss cannot also be created. The earlier config wins (the list arrives oldest first) and the
 * later one is named in `omitted` rather than dropped quietly.
 */
private fun mirroredParties(
    configs: List<SourceConfig>,
    seats: Map<Uuid, List<SourceSeat>>,
    theirs: Set<String>,
): Pair<List<InviteParty>, List<InviteOmission>> {
    val parties = mutableListOf<InviteParty>()
    val omitted = mutableListOf<InviteOmission>()
    val taken = mutableSetOf<Pair<String, String>>()

    // The configs with a seat of theirs, and which seat that is. Separated from the loop so what
    // makes a config travel is one statement rather than a jump out of the middle of the writing.
    val shared =
        configs.mapNotNull { config ->
            val roster = seats[config.partyId].orEmpty()
            roster.firstOrNull { it.name.lowercase() in theirs }?.let { Triple(config, roster, it) }
        }

    for ((config, roster, own) in shared) {
        val key = own.name.lowercase() to config.bossKey
        if (!taken.add(key)) {
            omitted += InviteOmission(config.bossKey, own.name, OMITTED_DUPLICATE_BOSS)
            continue
        }

        parties +=
            InviteParty(
                sourcePartyId = config.partyId.toString(),
                bossKey = config.bossKey,
                difficulty = config.difficulty,
                minutes = config.minutes,
                ownName = own.name,
                members = roster.filterNot { it.id == own.id }.map { it.name },
                shares = roster.associate { it.name to it.shares },
            )
    }
    return parties to omitted
}

/**
 * The recipient's characters, each in the world of the config it plays in.
 *
 * Every character the sender attributed to them, not only the ones in a shared party: the people
 * list is the sender's answer to "who plays what", and handing over half of it would make the
 * recipient's own roster look like it had gaps.
 *
 * A character in no shared config falls back to the account's world. That is an assumption where
 * the others are evidence, and it is the only answer available: a name with no party attached says
 * nothing about which world it is in.
 */
private fun recipientCharacters(
    names: List<String>,
    parties: List<InviteParty>,
    configs: List<SourceConfig>,
    fallback: String,
): List<InviteCharacter> {
    val worldByParty = configs.associate { it.partyId.toString() to it.worldType }
    val worldByName =
        parties.associate { it.ownName.lowercase() to worldByParty.getValue(it.sourcePartyId) }
    return names.map { InviteCharacter(it, worldByName[it.lowercase()] ?: fallback) }
}

/**
 * Who each of [seatNames] is, the sender always among them.
 *
 * Only the characters that turn up in a shared config. The sender knows more about some of these
 * people than the shared parties show, and the rest of an address book is not part of what one
 * friend hands another. A name attributable to nobody forms no person, which every board already
 * draws as an owner-less seat.
 */
private fun peopleIn(
    userId: String,
    senderName: String,
    seatNames: List<String>,
): List<InvitePerson> {
    val wanted = seatNames.map { it.lowercase() }.toSet()

    val mine =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .orderBy(Characters.position)
            .map { it[Characters.name] }
            .filter { it.lowercase() in wanted }

    val theirs =
        PersonCharacter
            .join(Person, JoinType.INNER, PersonCharacter.personId, Person.id)
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .map { it[Person.name] to it[PersonCharacter.name] }
            .filter { (_, character) -> character.lowercase() in wanted }
            .groupBy({ it.first }) { it.second }

    // Always, even with no characters to show for it. Somebody you share no config with still
    // receives a link FROM you, and their account is where the link is recorded as having come from
    // you: without this row there is nothing on their side to write linked_user_id onto, and the
    // binding would exist in one direction only.
    val sender = listOf(InvitePerson(senderName, mine, isSender = true))
    // A person the sender happens to have named the same as themselves would otherwise arrive as
    // two rows one save cannot hold, since a name identifies a person on the people board.
    val others =
        theirs
            .filterKeys { !it.equals(senderName, ignoreCase = true) }
            .map { (name, characters) -> InvitePerson(name, characters.sorted()) }
            .sortedBy { it.name }

    return sender + others
}

/** The sprite this account already holds for each name, leaving out the ones it has never found. */
private fun spritesFor(
    userId: String,
    names: List<String>,
): Map<String, String> {
    val wanted = names.map { it.lowercase() }.toSet()
    val fromSeats =
        seatSpritesByCharacter(userId)
            .mapNotNull { (name, seat) -> seat.spriteImgUrl?.let { name to it } }
    val fromOwn =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .mapNotNull { row -> row[Characters.spriteImgUrl]?.let { row[Characters.name] to it } }

    return (fromSeats + fromOwn).filter { (name, _) -> name.lowercase() in wanted }.toMap()
}
