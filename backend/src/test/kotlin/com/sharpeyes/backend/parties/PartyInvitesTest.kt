package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** A friend's character is offered a seat, and only their Accept writes it. */
class PartyInvitesTest {
    private val owner = "user_test_invites_owner"
    private val member = "user_test_invites_member"
    private val everyone = listOf(owner, member)
    private val now = Clock.System.now()

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
        transaction {
            Notification.deleteWhere { Notification.userId inList everyone }
            Party.deleteWhere { Party.userId inList everyone }
            Person.deleteWhere { Person.userId inList everyone }
            Characters.deleteWhere { Characters.userId inList everyone }
        }
    }

    private fun character(
        userId: String,
        name: String,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    /** [account] on [of]'s people list, linked. What a friendship writes. */
    private fun link(
        of: String,
        name: String,
        account: String,
    ) {
        savePeople(of, SavePeopleRequest(listOf(PersonRequest(null, name, emptyList()))), now)
        val id = Person.selectAll().where { (Person.userId eq of) and (Person.name eq name) }.single()[Person.id]
        Person.update({ Person.id eq id }) { it[linkedUserId] = account }
    }

    private val kalos get() = bossIdForKey("kalos-the-guardian")!!

    private fun party(
        userId: String,
        character: Uuid,
        members: List<String>,
    ): Uuid {
        val request = SavePartyRequest(character.toString(), "kalos-the-guardian", members)
        return createParty(userId, character, kalos, request, now)
    }

    private fun invitesTo(partyId: Uuid) = pendingInvitesFor(listOf(partyId))[partyId].orEmpty()

    @Test
    fun `a friend's character is invited rather than seated, and seated on Accept`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = party(owner, tide, listOf("Baldrix"))

            val (kept, invitees) = splitInvitees(owner, partyId, listOf("Baldrix", "Pinewick"))
            assertEquals(listOf("Baldrix"), kept)
            assertEquals(listOf("Pinewick"), invitees.map { it.name })

            assertEquals(listOf("Pinewick"), sendInvites(owner, partyId, invitees, now).invited)
            val invite = invitesTo(partyId).single()
            val told = Notification.selectAll().where { Notification.userId eq member }.single()
            assertEquals(NotificationKind.PARTY_INVITE, told[Notification.kind])
            // No seat while the invite stands, so nothing is shared with them yet.
            assertTrue(PartyMember.selectAll().where { PartyMember.linkedCharacterId eq pine }.empty())

            assertTrue(acceptInvite(member, Uuid.parse(invite.id), now) is InviteAnswer.Joined)
            val seat = PartyMember.selectAll().where { PartyMember.linkedCharacterId eq pine }.single()
            assertEquals(true, seat[PartyMember.standing])
            assertTrue(invitesTo(partyId).isEmpty())
            // In the party now, so naming them again seats rather than invites.
            assertTrue(splitInvitees(owner, partyId, listOf("Baldrix", "Pinewick")).second.isEmpty())
        }
    }

    @Test
    fun `a character already in a party for the boss is not invited`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            party(member, pine, listOf("Somebody"))
            val partyId = party(owner, tide, listOf("Baldrix"))

            val outcome = sendInvites(owner, partyId, listOf(Invitee("Pinewick", pine)), now)
            assertEquals(listOf("Pinewick"), outcome.alreadyPartied)
            assertTrue(outcome.invited.isEmpty())
            assertTrue(PartyInvite.selectAll().where { PartyInvite.partyId eq partyId }.empty())
        }
    }

    @Test
    fun `declining drops the invite and seats nobody`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = party(owner, tide, listOf("Baldrix"))
            sendInvites(owner, partyId, listOf(Invitee("Pinewick", pine)), now)
            val invite = invitesTo(partyId).single()

            assertTrue(dropInviteAs(member, Uuid.parse(invite.id), now))
            assertTrue(invitesTo(partyId).isEmpty())
            assertTrue(PartyMember.selectAll().where { PartyMember.linkedCharacterId eq pine }.empty())
        }
    }
}
