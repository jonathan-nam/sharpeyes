package com.sharpeyes.backend.groups

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.CharacterBossSkip
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.FriendGroup
import com.sharpeyes.backend.db.FriendGroupMember
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.parties.SeatContext
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.currentWeek
import com.sharpeyes.backend.parties.findParty
import com.sharpeyes.backend.parties.inviting
import com.sharpeyes.backend.parties.pendingInvitesFor
import com.sharpeyes.backend.parties.splitInvitees
import com.sharpeyes.backend.parties.weekInvites
import com.sharpeyes.backend.parties.withInvites
import com.sharpeyes.backend.parties.writeWeek
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
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** A groupmate's character is seated without an invite; everybody else is still invited. */
class GroupsTest {
    private val owner = "user_test_groups_owner"
    private val mate = "user_test_groups_mate"
    private val other = "user_test_groups_other"
    private val everyone = listOf(owner, mate, other)
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
            val accounts = everyone
            val groups =
                FriendGroupMember
                    .selectAll()
                    .where { FriendGroupMember.userId inList accounts }
                    .map { it[FriendGroupMember.groupId] }
            FriendGroup.deleteWhere { FriendGroup.id inList groups }
            Notification.deleteWhere { Notification.userId inList accounts }
            Party.deleteWhere { Party.userId inList accounts }
            Person.deleteWhere { Person.userId inList accounts }
            Users.update({ Users.id inList accounts }) { it[mainCharacterId] = null }
            Characters.deleteWhere { Characters.userId inList accounts }
        }
    }

    private fun character(
        account: String,
        name: String,
        level: Int? = null,
    ): Uuid {
        ensureUser(account, "$account@example.com")
        setActiveWorld(account, WORLD_INTERACTIVE)
        val id = Uuid.random()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = account
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[Characters.level] = level
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    /**
     * [account] on [of]'s people list, as a friendship writes it, or unlinked when null. The person's
     * id. Inserted rather than saved: savePeople replaces the whole list.
     */
    private fun link(
        of: String,
        name: String,
        account: String?,
    ): Uuid {
        val id = Uuid.random()
        Person.insert {
            it[Person.id] = id
            it[userId] = of
            it[Person.name] = name
            it[pinned] = false
            it[linkedUserId] = account
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }

    private val kalos get() = bossIdForKey("kalos-the-guardian")!!

    /** What POST /api/parties does: split the roster, save what is kept, then seat and invite. */
    private fun create(
        account: String,
        character: Uuid,
        members: List<String>,
        oneOff: Boolean = false,
    ): PartyResponse {
        val typed = SavePartyRequest(character.toString(), "kalos-the-guardian", members, oneOff = oneOff)
        val (request, split) = typed.inviting(account, null, kalos)
        val id = createParty(account, character, kalos, request, now)
        return findParty(id, account)!!.withInvites(account, split, now) as PartyResponse
    }

    /** A group of [owner] and [mate], [mate] having accepted. */
    private fun groupWithMate(matePerson: Uuid): Uuid {
        assertIs<GroupAnswer.Done>(createGroup(owner, "Tuesday Crew", now))
        val group = groupsOf(owner).single()
        assertIs<GroupAnswer.Done>(inviteToGroup(owner, group, matePerson, now))
        val invite = groupsFor(mate).invites.single()
        assertIs<GroupAnswer.Done>(acceptGroupInvite(mate, Uuid.parse(invite.id), now))
        return group
    }

    private fun seatOf(
        partyId: String,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq Uuid.parse(partyId)) and (PartyMember.name eq name) }
        .singleOrNull()

    @Test
    fun `joining needs an Accept, and only a friend can be invited`() {
        transaction {
            character(owner, "tidelark")
            character(mate, "Pinewick")
            val matePerson = link(owner, "Chris", mate)
            val stranger = link(owner, "Stranger", null)
            createGroup(owner, "Tuesday Crew", now)
            val group = groupsOf(owner).single()

            assertEquals(GroupAnswer.NotFound, inviteToGroup(owner, group, stranger, now))
            inviteToGroup(owner, group, matePerson, now)
            val told = Notification.selectAll().where { Notification.userId eq mate }.single()
            assertEquals(NotificationKind.GROUP_INVITE, told[Notification.kind])
            assertTrue(groupmatesOf(owner).isEmpty())
            assertEquals(
                "Chris",
                groupsFor(owner)
                    .groups
                    .single()
                    .invited
                    .single()
                    .member.name,
            )

            acceptGroupInvite(mate, Uuid.parse(groupsFor(mate).invites.single().id), now)
            assertEquals(setOf(mate), groupmatesOf(owner))
            assertTrue(Notification.selectAll().where { Notification.userId eq mate }.empty())
            assertIs<GroupAnswer.Refused>(inviteToGroup(owner, group, matePerson, now))
        }
    }

    @Test
    fun `a groupmate is seated at once, and a friend outside the group is invited`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(mate, "Pinewick")
            character(other, "Wrenfold")
            groupWithMate(link(owner, "Chris", mate))
            link(owner, "Dana", other)

            val party = create(owner, tide, listOf("Pinewick", "Wrenfold"))
            assertEquals(pine, seatOf(party.id, "Pinewick")!![PartyMember.linkedCharacterId])
            assertNull(seatOf(party.id, "Wrenfold"))
            assertEquals(listOf("Wrenfold"), party.invited)
            assertEquals(
                listOf("Wrenfold"),
                pendingInvitesFor(listOf(Uuid.parse(party.id))).values.flatten().map { it.name },
            )
            val told = Notification.selectAll().where { Notification.userId eq mate }.single()
            assertEquals(NotificationKind.PARTY_ADDED, told[Notification.kind])
        }
    }

    @Test
    fun `a groupmate already in a party for the boss is left out and said`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(mate, "Pinewick")
            groupWithMate(link(owner, "Chris", mate))
            create(mate, pine, listOf("Somebody"))

            val party = create(owner, tide, listOf("Pinewick", "Baldrix"))
            assertNull(seatOf(party.id, "Pinewick"))
            assertEquals(listOf("Pinewick"), party.alreadyPartied)
            assertTrue(party.invited.isEmpty())
        }
    }

    // A name typed before the friendship is a seat already, which insertSeat would not bind.
    @Test
    fun `a groupmate's existing seat is bound`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(mate, "Pinewick")
            val party = create(owner, tide, listOf("Pinewick"), oneOff = true)
            groupWithMate(link(owner, "Chris", mate))

            val partyId = Uuid.parse(party.id)
            val asking = weekInvites(owner, partyId, listOf("Pinewick"))
            writeWeek(partyId, tide, currentWeek(), asking.named, SeatContext(owner, emptyMap(), now))
            findParty(partyId, owner).withInvites(owner, asking.split, now)
            assertEquals(pine, seatOf(party.id, "Pinewick")!![PartyMember.linkedCharacterId])
        }
    }

    @Test
    fun `leaving stops the next add and keeps the seats already bound`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(mate, "Pinewick")
            val group = groupWithMate(link(owner, "Chris", mate))
            val party = create(owner, tide, listOf("Pinewick"))

            assertEquals(GroupAnswer.Done, leaveGroup(mate, group))
            assertEquals(pine, seatOf(party.id, "Pinewick")!![PartyMember.linkedCharacterId])
            val split = splitInvitees(owner, null, listOf("Pinewick"), kalos)
            assertEquals(listOf("Pinewick"), split.invitees.map { it.name })
            assertTrue(split.seated.isEmpty())
        }
    }

    // A friend of one member only would be a groupmate the others could not seat.
    @Test
    fun `only somebody friends with every member can be invited`() {
        transaction {
            character(owner, "tidelark")
            character(mate, "Pinewick")
            character(other, "Wrenfold")
            val group = groupWithMate(link(owner, "Chris", mate))
            val dana = link(owner, "Dana", other)

            assertTrue(
                groupsFor(owner)
                    .groups
                    .single()
                    .invitable
                    .isEmpty(),
            )
            assertIs<GroupAnswer.Refused>(inviteToGroup(owner, group, dana, now))

            link(mate, "Dana", other)
            assertEquals(
                listOf("Dana"),
                groupsFor(owner)
                    .groups
                    .single()
                    .invitable
                    .map { it.name },
            )
            assertEquals(GroupAnswer.Done, inviteToGroup(owner, group, dana, now))
        }
    }

    @Test
    fun `a group's roster brings each groupmate's main, else their highest level, and names who it cannot`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(mate, "Pinewick", level = 200)
            character(mate, "Bramble", level = 250)
            val wren = character(other, "Wrenfold")
            val group = groupWithMate(link(owner, "Chris", mate))
            val dana = link(owner, "Dana", other)
            link(mate, "Dana", other)
            inviteToGroup(owner, group, dana, now)
            acceptGroupInvite(other, Uuid.parse(groupsFor(other).invites.single().id), now)
            CharacterBossSkip.insert {
                it[characterId] = wren
                it[bossCatalogId] = kalos
                it[createdAt] = now
            }

            val roster = groupRoster(owner, group, tide, kalos)!!
            assertEquals(listOf("Bramble"), roster.members)
            assertEquals(listOf("Dana"), roster.missing)

            Users.update({ Users.id eq mate }) { it[mainCharacterId] = pine }
            assertEquals(listOf("Pinewick"), groupRoster(owner, group, tide, kalos)!!.members)
            assertNull(groupRoster(mate, group, tide, kalos))
        }
    }

    @Test
    fun `the last member out deletes the group`() {
        transaction {
            character(owner, "tidelark")
            character(mate, "Pinewick")
            val group = groupWithMate(link(owner, "Chris", mate))
            leaveGroup(owner, group)
            assertEquals(1, membersOf(group).size)
            leaveGroup(mate, group)
            assertTrue(FriendGroup.selectAll().where { FriendGroup.id eq group }.empty())
            assertEquals(GroupAnswer.NotFound, leaveGroup(mate, group))
        }
    }
}
