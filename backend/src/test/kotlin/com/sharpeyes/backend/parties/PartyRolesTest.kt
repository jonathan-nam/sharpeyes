package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyRole
import com.sharpeyes.backend.db.Person
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
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** Who may do what in a party: the owner, a member they made an Editor, and a member who reads. */
class PartyRolesTest {
    private val owner = "user_test_roles_owner"
    private val member = "user_test_roles_member"
    private val stranger = "user_test_roles_stranger"
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

    /** The owner, Chris on [member]'s account seated as CreedBratton, and Baldrix nobody claims. */
    private fun shared(): PartyResponse {
        val theirs = character(owner, "mechyfechy")
        character(member, "CreedBratton")
        link(owner, "Chris", member)
        return config(theirs, listOf("CreedBratton", "Baldrix"))
    }

    private fun setRole(
        party: PartyResponse,
        name: String,
        role: String,
        by: String = owner,
    ) = setMemberRole(by, Uuid.parse(party.id), seat(party, name)!![PartyMember.id], role, Clock.System.now())

    private fun roleOf(
        party: PartyResponse,
        userId: String,
    ) = roleIn(Uuid.parse(party.id), userId)

    @Test
    fun `a member reads until the owner makes them an Editor`() {
        transaction {
            val party = shared()
            assertEquals(ROLE_VIEWER, roleOf(party, member))
            assertFalse(canEditParty(Uuid.parse(party.id), member))

            assertEquals(RoleOutcome.Set, setRole(party, "CreedBratton", ROLE_EDITOR))

            assertEquals(ROLE_EDITOR, roleOf(party, member))
            assertTrue(canEditParty(Uuid.parse(party.id), member))
            assertEquals(ROLE_EDITOR, findParty(Uuid.parse(party.id), member)!!.role)
            val creed = findParty(Uuid.parse(party.id), owner)!!.seats.single { it.name == "CreedBratton" }
            assertEquals(ROLE_EDITOR, creed.role)
            assertEquals(ROLE_EDITOR, partiesSeatedIn(member).single().party.role)
        }
    }

    @Test
    fun `setting Viewer takes the Editor back`() {
        transaction {
            val party = shared()
            setRole(party, "CreedBratton", ROLE_EDITOR)
            assertEquals(RoleOutcome.Set, setRole(party, "CreedBratton", ROLE_VIEWER))
            assertEquals(ROLE_VIEWER, roleOf(party, member))
        }
    }

    @Test
    fun `only the owner sets a role, and nobody else learns the party exists`() {
        transaction {
            val party = shared()
            character(stranger, "Nobody")
            assertEquals(RoleOutcome.NotFound, setRole(party, "CreedBratton", ROLE_EDITOR, by = member))
            assertEquals(RoleOutcome.NotFound, setRole(party, "CreedBratton", ROLE_EDITOR, by = stranger))
            assertEquals(ROLE_VIEWER, roleOf(party, member))
            assertNull(roleOf(party, stranger))
            assertFalse(canEditParty(Uuid.parse(party.id), stranger))
        }
    }

    @Test
    fun `a seat nobody has claimed has no role to set`() {
        transaction {
            val party = shared()
            assertTrue(setRole(party, "Baldrix", ROLE_EDITOR) is RoleOutcome.Refused)
            assertNull(findParty(Uuid.parse(party.id), owner)!!.seats.single { it.name == "Baldrix" }.role)
        }
    }

    @Test
    fun `a role that is not Viewer or Editor is refused`() {
        transaction {
            val party = shared()
            assertTrue(setRole(party, "CreedBratton", ROLE_OWNER) is RoleOutcome.Refused)
            assertEquals(ROLE_VIEWER, roleOf(party, member))
        }
    }

    @Test
    fun `the owner is the owner`() {
        transaction {
            val party = shared()
            assertEquals(ROLE_OWNER, roleOf(party, owner))
            assertEquals(ROLE_OWNER, findParty(Uuid.parse(party.id), owner)!!.role)
        }
    }

    @Test
    fun `leaving drops the Editor, so coming back is as a Viewer`() {
        transaction {
            val party = shared()
            setRole(party, "CreedBratton", ROLE_EDITOR)
            assertTrue(leaveParty(member, Uuid.parse(party.id), Clock.System.now()))
            assertNull(roleOf(party, member))
            assertEquals(0, PartyRole.selectAll().where { PartyRole.userId eq member }.count())
        }
    }

    @Test
    fun `unlinking drops the Editor`() {
        transaction {
            val party = shared()
            setRole(party, "CreedBratton", ROLE_EDITOR)
            val chris = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]
            assertTrue(unlinkPerson(owner, chris))
            assertNull(roleOf(party, member))
            assertEquals(0, PartyRole.selectAll().where { PartyRole.userId eq member }.count())
        }
    }

    @Test
    fun `a stored Editor row grants nothing without a standing seat`() {
        transaction {
            val party = shared()
            setRole(party, "CreedBratton", ROLE_EDITOR)
            PartyMember.update({ PartyMember.id eq seat(party, "CreedBratton")!![PartyMember.id] }) {
                it[linkedCharacterId] = null
            }
            assertNull(roleOf(party, member))
            assertFalse(canEditParty(Uuid.parse(party.id), member))
        }
    }
}
