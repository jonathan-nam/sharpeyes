package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Reaching a party you do not own, and being unable to reach one you have no seat in.
 *
 * A shared party is ONE row, the owner's, and being in it is having a seat in it (V75). That makes
 * the roster the authorisation rule, which is the whole of what this file is here to hold: every
 * other party read in the app is filtered by `Party.userId eq userId`, and that filter is what
 * keeps two accounts apart. This is the one place it does not apply, so the test that matters most
 * is the negative one.
 */
class SeatedPartiesTest {
    private val owner = "user_test_seated_owner"
    private val member = "user_test_seated_member"
    private val stranger = "user_test_seated_stranger"
    private val everyone = listOf(owner, member, stranger)

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(
            url = jdbcUrl,
            driver = "org.postgresql.Driver",
            user = Env.dbUsername,
            password = Env.dbPassword,
        )
    }

    @AfterTest
    fun cleanUp() {
        val owners = everyone
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private fun character(
        userId: String,
        name: String,
        position: Int = 0,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[Characters.position] = position
        }
        return id
    }

    /** A person on [of]'s list, signing in as [account]. What accepting an invite writes. */
    private fun link(
        of: String,
        name: String,
        account: String,
    ) {
        savePeople(of, SavePeopleRequest(listOf(PersonRequest(null, name, emptyList()))), Clock.System.now())
        val id = Person.selectAll().where { Person.userId eq of }.single()[Person.id]
        Person.update({ Person.id eq id }) { it[linkedUserId] = account }
    }

    /** The owner's config, seating [members] beside their own character. */
    private fun config(
        ownCharacter: Uuid,
        members: List<String>,
    ): PartyResponse {
        val request = SavePartyRequest(ownCharacter.toString(), "kalos-the-guardian", members)
        val id = createParty(owner, ownCharacter, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
        return findParty(id, owner)!!
    }

    @Test
    fun `a character with a seat in somebody else's party reaches it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))

            val seated = partiesSeatedIn(member)
            assertEquals(listOf(party.id), seated.map { it.id })
            // The whole roster, as the owner arranged it, and which seat is mine.
            assertEquals(listOf("mechyfechy", "CreedBratton"), seated.single().seats.map { it.name })
            assertEquals(listOf(party.members[1].id), seated.single().mySeatIds)
        }
    }

    @Test
    fun `a party I have no seat in stays invisible`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(stranger, "Nosy")
            link(owner, "Chris", member)
            config(theirs, listOf("CreedBratton"))

            // The one that matters. Every other party read in the app is filtered by ownership, and
            // this is the read that is not, so a stranger reaching it would reach everything.
            assertEquals(emptyList(), partiesSeatedIn(stranger))
        }
    }

    @Test
    fun `a seat that only NAMES my character is not a seat in it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            // No link, so nothing bound the seat. The owner typed a name that happens to be a real
            // character of somebody's, which is not the same as that person being in the party, and
            // is exactly how a name match would hand an account to a stranger who picked the name.
            config(theirs, listOf("CreedBratton"))

            assertEquals(emptyList(), partiesSeatedIn(member))
        }
    }

    @Test
    fun `my own parties are not in it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            config(theirs, listOf("CreedBratton"))

            // The owner is seated in their own config, which partiesFor already answers for. Two
            // answers to one party is what the mirror used to be.
            assertEquals(emptyList(), partiesSeatedIn(owner))
        }
    }

    @Test
    fun `a seat retired out of the roster is a party I have left`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            assertTrue(partiesSeatedIn(member).isNotEmpty())

            PartyMember.update({ PartyMember.id eq Uuid.parse(party.members[1].id) }) {
                it[standing] = false
            }
            assertEquals(emptyList(), partiesSeatedIn(member))
        }
    }

    @Test
    fun `the seat carries the binding, and never as one of the owner's own`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            val mine = character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))

            val seat = party.members[1]
            assertEquals(mine.toString(), seat.linkedCharacterId)
            // characterId stays the owner's alone. V75 says so as a CHECK, and the coupon ledger
            // reads a non-null value as SELF.
            assertEquals(null, seat.characterId)
        }
    }

    @Test
    fun `the party a seat reaches is readable, and says it is not yours`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(stranger, "Nosy")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            val partyId = Uuid.parse(party.id)

            // The same row the owner reads, which is what makes the two screens one screen.
            val seen = assertNotNull(findParty(partyId, member))
            assertEquals(party.id, seen.id)
            assertEquals(listOf("mechyfechy", "CreedBratton"), seen.seats.map { it.name })
            assertFalse(seen.yours)
            assertTrue(findParty(partyId, owner)!!.yours)

            // And the negative, which is the one that matters: no seat, no party.
            assertNull(findParty(partyId, stranger))
        }
    }

    @Test
    fun `a member may read the pool and still not write it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(stranger, "Nosy")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            val partyId = Uuid.parse(party.id)

            assertTrue(canReadParty(partyId, member))
            // The line the whole feature rests on. Every write starts with ownsParty, so a pool
            // with two keyboards logging one night is not reachable from here.
            assertFalse(ownsParty(partyId, member))
            assertFalse(canReadParty(partyId, stranger))
        }
    }

    @Test
    fun `the clear on a shared party answers for YOUR character`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            val mine = character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            val partyId = Uuid.parse(party.id)

            // Their character has run it, the owner's has not. boss_clear is per CHARACTER, so the
            // owner's tick answers "have they", and a member reading it would be told they had run
            // a boss they have not.
            setClear(mine, "kalos-the-guardian")

            assertEquals(true, findParty(partyId, member)!!.cleared)
            assertNull(findParty(partyId, owner)!!.cleared)
        }
    }

    /** [character] has run [bossKey] this period, ticked by hand. */
    private fun setClear(
        character: Uuid,
        bossKey: String,
    ) {
        val boss = bossIdForKey(bossKey)!!
        val reset = bossResetOf(boss)!!
        BossClear.insert {
            it[characterId] = character
            it[bossCatalogId] = boss
            it[periodStart] = periodStartFor(reset, Clock.System.now())
            it[cleared] = true
            it[capturedAt] = Clock.System.now()
        }
    }

    /** A drop into [party]'s pool on [on], with the week's roster left as the usual one. */
    private fun drop(
        party: PartyResponse,
        on: LocalDate,
    ): Uuid =
        addLoot(
            Uuid.parse(party.id),
            LootedDrop(dropIdForKey("grindstone-of-faith")!!),
            bossIdForKey("kalos-the-guardian"),
            on,
            Clock.System.now(),
        )

    @Test
    fun `a member sees the nights they were on the roster for`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            drop(party, LocalDate.parse("2026-07-20"))

            val nights = partiesSeatedIn(member).single().nights
            assertEquals(1, nights.size)
            // The party's own record of that night, not a reduced copy of it: a second shape would
            // be a second implementation of what somebody is owed.
            assertEquals("Grindstone of Faith", nights.single().name)
            assertTrue(nights.single().ranThatWeek.contains(party.members[1].id))
        }
    }

    @Test
    fun `a night the member was not on stays out of it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            val night = LocalDate.parse("2026-07-20")

            // The owner ran that week without them, spelled out as a roster of one.
            saveWeekRoster(
                Uuid.parse(party.id),
                Uuid.parse(party.characterId),
                weekOf(night),
                emptyList(),
                SeatContext(owner, emptyMap(), Clock.System.now()),
            )
            drop(party, night)

            // A pool spans months and a member was not there for most of it. This is the claim the
            // whole read exists to make, and the one that costs money if it is wrong.
            assertEquals(emptyList(), partiesSeatedIn(member).single().nights)
        }
    }

    @Test
    fun `the owner's own read is untouched by any of it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            drop(party, LocalDate.parse("2026-07-20"))

            // partiesFor is what every party screen reads. It is owner-scoped and stays that way:
            // the crossing happens in partiesSeatedIn and nowhere else.
            assertEquals(1, lootFor(Uuid.parse(party.id)).size)
            assertEquals(listOf(party.id), partiesFor(owner).map { it.id })
            assertEquals(emptyList(), partiesFor(member))
        }
    }

    @Test
    fun `unlinking takes the account off the person AND its seats back`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            assertTrue(partiesSeatedIn(member).isNotEmpty(), "the member should be able to reach it first")

            val chris = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]
            assertTrue(unlinkPerson(owner, chris))

            // The half that matters. partiesSeatedIn authorises on party_member.linked_character_id
            // and NOT on person.linked_user_id, so clearing the person alone would leave the seat
            // bound and the other account still reading the party, its roster and its nights. An
            // unlink that does not revoke is worse than none, because it looks like it worked.
            assertEquals(emptyList(), partiesSeatedIn(member))
            assertNull(
                PartyMember
                    .selectAll()
                    .where { PartyMember.id eq Uuid.parse(party.members[1].id) }
                    .single()[PartyMember.linkedCharacterId],
            )
        }
    }

    @Test
    fun `unlinking keeps the person and what this account said about them`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            savePeople(
                owner,
                SavePeopleRequest(listOf(PersonRequest(null, "Chris", listOf("AnAltOfTheirs")))),
                Clock.System.now(),
            )
            val chris = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]
            Person.update({ Person.id eq chris }) { it[linkedUserId] = member }
            config(theirs, listOf("CreedBratton"))

            unlinkPerson(owner, chris)

            // "That is not their account" is not "I do not know them". Deleting the person would
            // take the attributions with it, and a payout still points at the seats.
            val after = peopleFor(owner).single()
            assertEquals("Chris", after.name)
            assertEquals(listOf("AnAltOfTheirs"), after.characters)
        }
    }

    @Test
    fun `unlinking somebody who was never linked is a success, and unlinking a stranger's person is not`() {
        transaction {
            character(owner, "mechyfechy")
            savePeople(
                owner,
                SavePeopleRequest(listOf(PersonRequest(null, "Dwight", emptyList()))),
                Clock.System.now(),
            )
            val dwight = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]

            // Idempotent: the caller asked for a state and it is already the state.
            assertTrue(unlinkPerson(owner, dwight))
            // Not yours, so not found, rather than a quiet no-op that reads as having worked.
            assertFalse(unlinkPerson(stranger, dwight))
        }
    }
}
