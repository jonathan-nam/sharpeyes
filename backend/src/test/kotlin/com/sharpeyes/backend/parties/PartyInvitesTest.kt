package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.RosterResult
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyInvite
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notificationsFor
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.minus
import kotlinx.datetime.plus
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
import kotlin.time.Duration.Companion.days
import kotlin.uuid.Uuid

/** A friend's character is offered a seat, and only their Accept writes it. */
class PartyInvitesTest {
    private val owner = "user_test_invites_owner"
    private val member = "user_test_invites_member"
    private val other = "user_test_invites_other"
    private val everyone = listOf(owner, member, other)
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
            val theirs = Characters.selectAll().where { Characters.userId inList accounts }.map { it[Characters.id] }
            BossClear.deleteWhere { BossClear.characterId inList theirs }
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

    /** What POST /api/parties does: split the roster, save what is kept, then bind, ask and tell. */
    private fun create(
        character: Uuid,
        members: List<String>,
        account: String = owner,
        bossKey: String = "kalos-the-guardian",
    ): PartyResponse {
        val boss = bossIdForKey(bossKey)!!
        val typed = SavePartyRequest(character.toString(), bossKey, members)
        val (request, split) = typed.seatingFriends(account, null, boss, oneOff = false, now = now)
        val id = createParty(account, character, boss, request, now)
        return findParty(id, account)!!.withFriendSeats(account, split, now) as PartyResponse
    }

    /** What POST /api/parties/{id}/week does for this week. */
    private fun guestThisWeek(
        partyId: Uuid,
        character: Uuid,
        members: List<String>,
    ): PartyResponse {
        val asking = weekSplit(owner, partyId, members, currentWeek(), now)
        if (asking.writes) {
            writeWeek(
                partyId,
                character,
                currentWeek(),
                asking.named,
                SeatContext(owner, emptyMap(), now),
            )
        }
        return findParty(partyId, owner).withFriendSeats(owner, asking.split, now) as PartyResponse
    }

    /**
     * Pinewick sitting in [other]'s regular Kalos party, a friend of everybody's: the party nobody
     * disbanded. Started two weeks ago, so it has weeks behind it.
     */
    private fun pinewickInOthersParty(): Triple<Uuid, Uuid, Uuid> {
        val wren = character(other, "Wrenfold")
        val pine = character(member, "Pinewick")
        link(other, "Chris", member)
        val held = Uuid.parse(create(wren, listOf("Pinewick"), account = other).id)
        Party.update({ Party.id eq held }) { it[partySince] = now - 14.days }
        return Triple(held, wren, pine)
    }

    private fun ranThisWeek(character: Uuid) {
        BossClear.insert {
            it[characterId] = character
            it[bossCatalogId] = kalos
            it[periodStart] = currentWeek()
            it[cleared] = true
            it[capturedAt] = now
        }
    }

    private fun notesTo(account: String) = Notification.selectAll().where { Notification.userId eq account }.toList()

    /** What [account]'s bell shows, as the server writes it. */
    private fun bell(account: String) = notificationsFor(account).notifications

    private fun seatOf(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .single()

    @Test
    fun `a friend in a one-off's night sees the party, and its face is on it`() {
        transaction {
            val tide = character(owner, "tidelark")
            character(member, "Pinewick")
            link(owner, "Chris", member)
            // A one-off keeps every seat but the owner's out of the usual roster: only the night names it.
            val partyId = oneOff(owner, tide, listOf("Pinewick"))

            // The owner and the friend, which is what draws the friend's Discord face on the party.
            assertEquals(listOf(true, false), accountsFor(listOf(partyId), owner)[partyId]!!.map { it.you })
            assertEquals(listOf(partyId.toString()), partiesSeatedIn(member).map { it.party.id })
            assertTrue(member in audienceOf(partyId))
        }
    }

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
            findParty(
                partyId,
                owner,
            ).withFriendSeats(owner, splitFriends(owner, partyId, listOf("Pinewick"), now = now), now)
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

    // The character IS that party, so there is nothing to move it out of.
    @Test
    fun `a friend's character with its own party for the boss is left out and said`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            party(member, pine, listOf("Somebody"))

            val party = create(tide, listOf("Pinewick", "Baldrix"))
            assertEquals(listOf("Pinewick"), party.alreadyPartied)
            assertEquals(RosterResult.LEFT_OUT, party.outcome.single().result)
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

            guestThisWeek(partyId, tide, listOf("Pinewick"))
            assertEquals(pine, seatOf(partyId, "Pinewick")[PartyMember.linkedCharacterId])
        }
    }

    // A party nobody disbanded holds the character, and only its player moves it.
    @Test
    fun `a friend in another party is asked, and Move takes it out of that party`() {
        transaction {
            val (held, _, pine) = pinewickInOthersParty()
            val tide = character(owner, "tidelark")
            link(owner, "Chris", member)

            val party = create(tide, listOf("Pinewick"))
            val partyId = Uuid.parse(party.id)
            assertEquals(RosterResult.ASKED, party.outcome.single().result)
            assertEquals(listOf("Pinewick"), party.invited)
            assertTrue(
                PartyMember
                    .selectAll()
                    .where {
                        (PartyMember.partyId eq partyId) and
                            (PartyMember.name eq "Pinewick")
                    }.empty(),
            )
            val ask = notesTo(member).single { it[Notification.kind] == NotificationKind.PARTY_INVITE }
            assertEquals(
                listOf("Move", "Stay"),
                bell(member)
                    .single {
                        it.kind == NotificationKind.PARTY_INVITE
                    }.actions
                    .map { it.label },
            )

            assertTrue(acceptInvite(member, ask[Notification.subjectId]!!, now) is InviteAnswer.Joined)
            assertEquals(pine, seatOf(partyId, "Pinewick")[PartyMember.linkedCharacterId])
            val left = seatOf(held, "Pinewick")
            assertEquals(false, left[PartyMember.standing])
            assertEquals(null, left[PartyMember.linkedCharacterId])
            // The weeks it ran there keep it, so a drop logged late still splits with it.
            assertTrue("Pinewick" in rosterNamesFor(held, currentWeek().minus(1, DateTimeUnit.WEEK)))
            assertTrue("Pinewick" !in rosterNamesFor(held, currentWeek()))
        }
    }

    // The owner left behind need not be a friend of the party it went to, so is told nothing of it.
    @Test
    fun `the owner it left is told only that it left`() {
        transaction {
            pinewickInOthersParty()
            val tide = character(owner, "tidelark")
            link(owner, "Chris", member)
            create(tide, listOf("Pinewick"))
            val ask = notesTo(member).single { it[Notification.kind] == NotificationKind.PARTY_INVITE }
            acceptInvite(member, ask[Notification.subjectId]!!, now)

            val note = bell(other).single()
            assertEquals(NotificationKind.CHARACTER_LEFT, note.kind)
            assertEquals("Pinewick has left Kalos the Guardian.", note.text)
            assertTrue("tidelark" !in note.payload.toString())
        }
    }

    // It ran with its old party this week, so this week is that party's and the move counts from the next.
    @Test
    fun `a move from a party that ran this week counts from next week`() {
        transaction {
            val (held, wren, _) = pinewickInOthersParty()
            ranThisWeek(wren)
            val tide = character(owner, "tidelark")
            link(owner, "Chris", member)
            val partyId = Uuid.parse(create(tide, listOf("Baldrix", "Pinewick")).id)
            val ask = notesTo(member).single { it[Notification.kind] == NotificationKind.PARTY_INVITE }
            acceptInvite(member, ask[Notification.subjectId]!!, now)

            assertTrue("Pinewick" in rosterNamesFor(held, currentWeek()))
            assertTrue("Pinewick" !in rosterNamesFor(partyId, currentWeek()))
            assertTrue("Pinewick" in rosterNamesFor(partyId, currentWeek().plus(1, DateTimeUnit.WEEK)))
        }
    }

    @Test
    fun `a friend named for one week runs it as a guest and its party keeps it`() {
        transaction {
            val (held, _, pine) = pinewickInOthersParty()
            val tide = character(owner, "tidelark")
            link(owner, "Chris", member)
            val partyId = party(owner, tide, listOf("Baldrix"))

            val saved = guestThisWeek(partyId, tide, listOf("Baldrix", "Pinewick"))
            assertEquals(RosterResult.GUEST, saved.outcome.single().result)
            assertEquals(pine, seatOf(partyId, "Pinewick")[PartyMember.linkedCharacterId])
            assertEquals(true, seatOf(held, "Pinewick")[PartyMember.standing])
            assertTrue("Pinewick" !in rosterNamesFor(held, currentWeek()))
            assertEquals("Pinewick is running Kalos the Guardian elsewhere this week.", bell(other).single().text)
        }
    }

    // A character clears a weekly boss once a week, so one of the two would be wrong.
    @Test
    fun `a player switching several bosses at once leaves the old owner one note`() {
        transaction {
            val (_, wren, _) = pinewickInOthersParty()
            create(wren, listOf("Pinewick"), account = other, bossKey = "lotus")
            val tide = character(owner, "tidelark")
            link(owner, "Chris", member)
            create(tide, listOf("Pinewick"))
            create(tide, listOf("Pinewick"), bossKey = "lotus")
            notesTo(member)
                .filter { it[Notification.kind] == NotificationKind.PARTY_INVITE }
                .forEach { acceptInvite(member, it[Notification.subjectId]!!, now) }

            assertEquals("Pinewick has left Kalos the Guardian and 1 other boss.", bell(other).single().text)
        }
    }

    @Test
    fun `a friend that already ran the boss this week elsewhere is left out`() {
        transaction {
            val (_, wren, _) = pinewickInOthersParty()
            ranThisWeek(wren)
            val tide = character(owner, "tidelark")
            link(owner, "Chris", member)
            val partyId = party(owner, tide, listOf("Baldrix"))

            val saved = guestThisWeek(partyId, tide, listOf("Baldrix", "Pinewick"))
            val outcome = saved.outcome.single()
            assertEquals(RosterResult.LEFT_OUT, outcome.result)
            assertEquals("Pinewick already ran Kalos the Guardian this week.", outcome.text)
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

    // Rosters are ordered by position, so a tie came back in either order. It made the test above flaky.
    @Test
    fun `a friend accepting a one-off leaves every seat its own position`() {
        transaction {
            val tide = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            link(owner, "Chris", member)
            val partyId = oneOff(owner, tide, listOf("Baldrix"))

            acceptPending(partyId, pine)
            val seats = PartyMember.selectAll().where { PartyMember.partyId eq partyId }
            val positions = seats.map { it[PartyMember.position] }
            assertEquals(positions.size, positions.toSet().size, "positions $positions")
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
