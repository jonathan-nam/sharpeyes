package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
import com.sharpeyes.backend.bosses.weekOf
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

    private fun oneOff(
        userId: String,
        character: Uuid,
        members: List<String>,
    ): Uuid {
        val request = SavePartyRequest(character.toString(), "kalos-the-guardian", members, oneOff = true)
        return createParty(userId, character, kalos, request, now)
    }

    private fun invitesTo(partyId: Uuid) = pendingInvitesFor(listOf(partyId))[partyId].orEmpty()

    /** An invite still pending from before they stopped being sent. */
    private fun pending(
        partyId: Uuid,
        characterId: Uuid,
    ) {
        PartyInvite.insert {
            it[id] = Uuid.random()
            it[PartyInvite.partyId] = partyId
            it[PartyInvite.characterId] = characterId
            it[invitedBy] = owner
            it[createdAt] = now
        }
    }

    private fun acceptPending(
        partyId: Uuid,
        characterId: Uuid,
    ) {
        pending(partyId, characterId)
        assertTrue(acceptInvite(member, Uuid.parse(invitesTo(partyId).single().id), now) is InviteAnswer.Joined)
    }

    /** What POST /api/parties does: split the roster, save what is kept, then bind and tell. */
    private fun create(
        character: Uuid,
        members: List<String>,
    ): PartyResponse {
        val typed = SavePartyRequest(character.toString(), "kalos-the-guardian", members)
        val (request, split) = typed.seatingFriends(owner, null, kalos)
        val id = createParty(owner, character, kalos, request, now)
        return findParty(id, owner)!!.withFriendSeats(owner, split, now) as PartyResponse
    }

    private fun seatOf(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .single()

    @Test
    fun `a friend's character is seated and bound at once, and told`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)

            val party = create(tide, listOf("Baldrix", "Pinewick"))
            val partyId = Uuid.parse(party.id)
            assertEquals(pine, seatOf(partyId, "Pinewick")[PartyMember.linkedCharacterId])
            assertTrue(invitesTo(partyId).isEmpty())
            val told = Notification.selectAll().where { Notification.userId eq member }.single()
            assertEquals(NotificationKind.PARTY_ADDED, told[Notification.kind])

            // Saved again, nothing is new, so nobody is told twice.
            findParty(partyId, owner).withFriendSeats(owner, splitFriends(owner, partyId, listOf("Pinewick")), now)
            assertEquals(1, Notification.selectAll().where { Notification.userId eq member }.count())
        }
    }

    // Only a friendship binds: a typed name is a stranger's otherwise, and they did not agree to it.
    @Test
    fun `a stranger's character is a seat that binds to nobody`() {
        transaction {
            val tide = character(owner, "tidelark")
            character(member, "Pinewick")

            val party = create(tide, listOf("Pinewick"))
            assertEquals(null, seatOf(Uuid.parse(party.id), "Pinewick")[PartyMember.linkedCharacterId])
            assertTrue(Notification.selectAll().where { Notification.userId eq member }.empty())
        }
    }

    @Test
    fun `a friend already in a party for the boss is left out and said`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            party(member, pine, listOf("Somebody"))

            val party = create(tide, listOf("Pinewick", "Baldrix"))
            assertEquals(listOf("Pinewick"), party.alreadyPartied)
            assertTrue(
                PartyMember
                    .selectAll()
                    .where { (PartyMember.partyId eq Uuid.parse(party.id)) and (PartyMember.name eq "Pinewick") }
                    .empty(),
            )
        }
    }

    // A name typed before the friendship is a seat already, which insertSeat would not bind.
    @Test
    fun `naming a friend binds the seat their character already has`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            val partyId = oneOff(owner, tide, listOf("Pinewick"))
            link(owner, "Chris", member)

            val asking = weekSplit(owner, partyId, listOf("Pinewick"))
            writeWeek(partyId, tide, currentWeek(), asking.named, SeatContext(owner, emptyMap(), now))
            findParty(partyId, owner).withFriendSeats(owner, asking.split, now)
            assertEquals(pine, seatOf(partyId, "Pinewick")[PartyMember.linkedCharacterId])
        }
    }

    // A one-off's party is its night roster, so a friend seated only in the usual one did not run.
    @Test
    fun `a friend accepting a one-off runs its night`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = oneOff(owner, tide, listOf("Baldrix"))

            acceptPending(partyId, pine)
            assertEquals(1, PartyMember.selectAll().where { PartyMember.linkedCharacterId eq pine }.count())
            assertEquals(
                listOf("tidelark", "Baldrix", "Pinewick"),
                rosterNamesFor(partyId, weekOf(todayIn(now))),
            )
        }
    }

    // A seat typed before the friendship, or unbound when the party was taken off the lists.
    @Test
    fun `accepting binds the seat the character already has`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            val partyId = oneOff(owner, tide, listOf("Pinewick"))
            link(owner, "Chris", member)

            acceptPending(partyId, pine)
            val seat =
                PartyMember
                    .selectAll()
                    .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq "Pinewick") }
                    .single()
            assertEquals(pine, seat[PartyMember.linkedCharacterId])
        }
    }

    @Test
    fun `declining drops the invite and seats nobody`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = party(owner, tide, listOf("Baldrix"))
            pending(partyId, pine)
            val invite = invitesTo(partyId).single()

            assertTrue(dropInviteAs(member, Uuid.parse(invite.id), now))
            assertTrue(invitesTo(partyId).isEmpty())
            assertTrue(PartyMember.selectAll().where { PartyMember.linkedCharacterId eq pine }.empty())
        }
    }

    // A solo pool has no card to withdraw it from, so Social lists what you sent.
    @Test
    fun `the owner sees an invite from a solo pool and can withdraw it`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = createSoloParty(owner, tide, kalos, now)
            pending(partyId, pine)

            val sent = invitesSentBy(owner).single()
            assertEquals("Pinewick", sent.character)
            assertEquals("tidelark", sent.leader)
            assertTrue(invitesSentBy(member).isEmpty())

            assertTrue(dropInviteAs(owner, Uuid.parse(sent.id), now))
            assertTrue(invitesSentBy(owner).isEmpty())
            assertTrue(invitesWaitingOn(member).isEmpty())
        }
    }

    // Social lists them, so an invite cleared from the bell can still be answered.
    @Test
    fun `an invite waits on the invitee, named the way the bell names it, and on nobody else`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = party(owner, tide, listOf("Baldrix"))
            pending(partyId, pine)

            val waiting = invitesWaitingOn(member).single()
            assertEquals(invitesTo(partyId).single().id, waiting.id)
            assertEquals("Pinewick", waiting.character)
            assertEquals("tidelark", waiting.leader)
            assertTrue(invitesWaitingOn(owner).isEmpty())

            dropInviteAs(member, Uuid.parse(waiting.id), now)
            assertTrue(invitesWaitingOn(member).isEmpty())
        }
    }
}
