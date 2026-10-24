package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.users.inActiveWorld
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Whose character a character is. Its own file rather than another few functions in PartyQueries,
// because both of that file's people reads go through it and neither owns it.
// Must be called from inside a `transaction { }` block.

/**
 * The characters each of this account's people plays, and how each of them came to be known.
 *
 * Two sources, and they are not equal. `attributed` is person_character: what the account owner
 * SAID, one name at a time on the People page. `owned` is what a person's own account holds, once
 * they have accepted an invite and person.linked_user_id names them (V70). That is not something
 * you said about them, it is something they did, so it is not yours to edit and it wins wherever
 * the two disagree. Evidence over assumption, the order CharacterRoutes already keeps between a
 * Nexon lookup and the world you happen to be looking at.
 *
 * Both readers go through this rather than querying person_character themselves, or the People
 * page and the seat under it could name different people for the same character.
 */
internal class PersonCharacters(
    val attributed: Map<Uuid, List<String>>,
    linkedCharacters: List<LinkedCharacter>,
) {
    /** Their own account's answer, by person. What the People page draws as not yours to edit. */
    val owned: Map<Uuid, List<String>> =
        linkedCharacters
            .groupBy({ it.personId }) { it.name }
            .mapValues { (_, names) -> names.sorted() }

    /** Each owned character's job, by person, for the ones their account recorded one for. */
    val ownedJobs: Map<Uuid, Map<String, String>> =
        linkedCharacters
            .mapNotNull { c -> c.jobName?.let { job -> c.personId to (c.name to job) } }
            .groupBy({ it.first }) { it.second }
            .mapValues { (_, pairs) -> pairs.toMap() }

    /** Lowercased character name to whoever plays them. */
    fun byCharacter(): Map<String, Uuid> =
        buildMap {
            for ((personId, names) in attributed) {
                for (name in names) put(name.lowercase(), personId)
            }
            // Second, so it overwrites what was attributed. See the note on precedence above.
            for ((personId, names) in owned) {
                for (name in names) put(name.lowercase(), personId)
            }
        }
}

/**
 * One character on a linked person's own account, which a seat of this account's names.
 *
 * Deliberately NOT written onto party_member.character_id. That column means "this seat is one of
 * MY characters" and four readers depend on it saying so, one of them the coupon ledger, which
 * returns SELF on a non-null value. Pointing it at somebody else's character would report their
 * pieces as yours, silently, which is the failure this repo exists to prevent.
 */
internal data class LinkedCharacter(
    val characterId: Uuid,
    val personId: Uuid,
    val name: String,
    val spriteImgUrl: String?,
    val jobName: String? = null,
)

internal fun personCharacters(userId: String): PersonCharacters {
    val attributed =
        PersonCharacter
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .orderBy(PersonCharacter.name)
            .groupBy({ it[PersonCharacter.personId] }) { it[PersonCharacter.name] }
    return PersonCharacters(attributed, ownedByLinkedAccounts(userId))
}

/**
 * The characters a linked person's own account holds, of the ones this account already seats.
 *
 * Only the seated ones. Their roster is theirs: a person with forty mules is not forty rows in
 * your ledger, and the only question this answers is whose seat a seat is, which a character you
 * have never run with is not an answer to. It also means linking someone shows you nothing about
 * their account you had not already typed in yourself.
 *
 * Narrowed to the world being shown, like every other account-wide read. A party is in one world,
 * so the other world's characters cannot be the seat in front of you.
 */
private fun ownedByLinkedAccounts(userId: String): List<LinkedCharacter> {
    // A name two linked accounts hold is nobody's: see LinkedRoster.
    val contested = linkedRosterFor(userId).contested
    val personByAccount =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .mapNotNull { row -> row[Person.linkedUserId]?.let { it to row[Person.id] } }
            .toMap()
    if (personByAccount.isEmpty()) return emptyList()

    val seated =
        PartyMember
            .innerJoin(Party)
            .selectAll()
            .where { Party.userId eq userId }
            .mapTo(mutableSetOf()) { it[PartyMember.name].lowercase() }

    return if (seated.isEmpty()) {
        emptyList()
    } else {
        Characters
            .selectAll()
            .where {
                (Characters.userId inList personByAccount.keys.toList()) and inActiveWorld(userId)
            }.mapNotNull { row ->
                val personId = personByAccount[row[Characters.userId]] ?: return@mapNotNull null
                val name = row[Characters.name]
                if (name.lowercase() !in seated || name.lowercase() in contested) {
                    null
                } else {
                    LinkedCharacter(
                        characterId = row[Characters.id],
                        personId = personId,
                        name = name,
                        spriteImgUrl = row[Characters.spriteImgUrl],
                        jobName = row[Characters.jobName],
                    )
                }
            }
    }
}

/**
 * Every character a linked person's own account holds, by lowercased name.
 *
 * For BINDING a seat, which is a different job from attributing one, so it is a different query.
 * ownedByLinkedAccounts is narrowed to characters this account already seats, because a person's
 * roster is theirs and the People page has no business listing forty of their mules. Binding is
 * asked about a name the caller has just typed into a roster themselves, so narrowing it to what is
 * already seated would refuse to bind the very seat being written.
 *
 * Nothing this returns is ever sent anywhere. It answers "is the name in front of me a real
 * character of theirs", and the caller already knew the name.
 */
internal fun linkedCharactersFor(userId: String): Map<String, Uuid> = linkedRosterFor(userId).sole()

/**
 * Every character on the accounts [userId]'s people are linked to, in the world being shown.
 *
 * Nothing stops two accounts adding the same character, and nothing can prove which is its player.
 * So a name more than one of them holds belongs to none: see [contested].
 */
internal class LinkedRoster(
    /** Lowercased name to every (account, character) holding it. */
    private val holders: Map<String, List<Pair<String, Uuid>>>,
    /** Lowercased name to the game's own spelling of it. */
    private val spelled: Map<String, String> = emptyMap(),
) {
    /** Names held by more than one linked account. No seat binds to these and no row owns them. */
    val contested: Set<String> = holders.filterValues { held -> held.map { it.first }.toSet().size > 1 }.keys

    /** The one character a name is, when exactly one linked account holds it. */
    fun soleCharacter(name: String): Uuid? =
        holders[name.lowercase()]?.takeIf { name.lowercase() !in contested }?.first()?.second

    /** Every name exactly one linked account holds, to the character it is. */
    fun sole(): Map<String, Uuid> =
        holders.filterKeys { it !in contested }.mapValues { (_, held) -> held.first().second }

    /** What you filed under a person linked to [account] that the account does not hold. */
    fun notOnAccount(
        account: String?,
        attributed: List<String>,
    ): List<String> {
        val theirs = account?.let { namesOf(it) } ?: return emptyList()
        return attributed.filter { it.lowercase() !in theirs }
    }

    /** [account]'s contested characters that you seat or filed under them, as the game spells them. */
    fun contestedFor(
        account: String?,
        attributed: List<String>,
        seated: Set<String>,
    ): List<String> {
        val yours = seated + attributed.map { it.lowercase() }
        return account
            ?.let { namesOf(it) }
            .orEmpty()
            .filter { it in contested && it in yours }
            .map { spelled[it] ?: it }
            .sorted()
    }

    /** The lowercased names [account] holds. */
    fun namesOf(account: String): Set<String> = holders.filterValues { held -> held.any { it.first == account } }.keys
}

internal fun linkedRosterFor(userId: String): LinkedRoster {
    val accounts =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .mapNotNull { it[Person.linkedUserId] }
    if (accounts.isEmpty()) return LinkedRoster(emptyMap())
    val rows =
        Characters
            .selectAll()
            .where { (Characters.userId inList accounts) and inActiveWorld(userId) }
            .toList()
    return LinkedRoster(
        rows.groupBy({ it[Characters.name].lowercase() }) { it[Characters.userId] to it[Characters.id] },
        rows.associate { it[Characters.name].lowercase() to it[Characters.name] },
    )
}
