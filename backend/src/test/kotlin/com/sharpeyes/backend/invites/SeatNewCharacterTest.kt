package com.sharpeyes.backend.invites

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.parties.PartyResponse
import com.sharpeyes.backend.parties.PersonRequest
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SavePeopleRequest
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.findParty
import com.sharpeyes.backend.parties.partiesSeatedIn
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** A character added after accepting an invite, seated where the sender already named it. */
class SeatNewCharacterTest {
    private val owner = "user_test_seatnew_owner"
    private val member = "user_test_seatnew_member"
    private val stranger = "user_test_seatnew_stranger"
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
        shares: Map<String, Int> = emptyMap(),
    ): PartyResponse {
        val request = SavePartyRequest(ownCharacter.toString(), "kalos-the-guardian", members, shares)
        val id = createParty(owner, ownCharacter, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
        return findParty(id, owner)!!
    }

    private fun seat(
        party: PartyResponse,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq Uuid.parse(party.id)) and (PartyMember.name eq name) }
        .firstOrNull()

    private fun seatOf(
        party: PartyResponse,
        name: String,
    ) = seat(party, name)!![PartyMember.linkedCharacterId]

    @Test
    fun `a character added after joining takes the seat the sender made for it`() {
        transaction {
            val theirs = character(owner, "mechobotto")
            character(member, "CraneBolton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CraneBolton", "LaterAlt"))
            assertNull(seatOf(party, "LaterAlt"))

            val alt = character(member, "LaterAlt", position = 1)
            seatInLinkedParties(member, alt, "laterALT", WORLD_INTERACTIVE)

            assertEquals(alt, seatOf(party, "LaterAlt"))
            assertTrue(partiesSeatedIn(member).isNotEmpty())
        }
    }

    @Test
    fun `nobody unlinked takes a seat by naming it`() {
        transaction {
            val theirs = character(owner, "mechobotto")
            val party = config(theirs, listOf("LaterAlt"))
            val impostor = character(stranger, "LaterAlt")
            seatInLinkedParties(stranger, impostor, "LaterAlt", WORLD_INTERACTIVE)
            assertNull(seatOf(party, "LaterAlt"))
        }
    }

    @Test
    fun `a name in the other world is somebody else`() {
        transaction {
            val theirs = character(owner, "mechobotto")
            character(member, "CraneBolton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CraneBolton", "LaterAlt"))
            val alt = character(member, "LaterAlt", position = 1)
            seatInLinkedParties(member, alt, "LaterAlt", "HEROIC")
            assertNull(seatOf(party, "LaterAlt"))
        }
    }
}
