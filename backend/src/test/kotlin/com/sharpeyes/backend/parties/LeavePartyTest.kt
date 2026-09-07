package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.LocalDate
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

/**
 * A member taking their own seat out of a party they are in but do not own.
 *
 * The app's first write that crosses accounts, so the negative tests carry the same weight they do
 * in SeatedPartiesTest: this must reach nothing but the caller's own seats. The rest is about the
 * owner's money, which a member leaving must not move. A night already played keeps its roster and
 * its debts, and the people staying keep the split they agreed.
 */
class LeavePartyTest {
    private val owner = "user_test_leave_owner"
    private val member = "user_test_leave_member"
    private val stranger = "user_test_leave_stranger"
    private val everyone = listOf(owner, member, stranger)
    private val night = LocalDate.parse("2026-07-20")

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

    private fun leave(
        userId: String,
        party: PartyResponse,
    ) = leaveParty(userId, Uuid.parse(party.id), Clock.System.now())

    /** The usual roster, sorted: standingRosterOf answers with no order of its own. */
    private fun standing(party: PartyResponse) = standingRosterOf(Uuid.parse(party.id)).sorted()

    private fun seat(
        party: PartyResponse,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq Uuid.parse(party.id)) and (PartyMember.name eq name) }
        .firstOrNull()

    @Test
    fun `a member takes their own seat out, and stops reading the party`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(owner, "Baldrix", position = 1)
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton", "Baldrix"))
            assertTrue(partiesSeatedIn(member).isNotEmpty())

            assertTrue(leave(member, party))

            // The read and the write agree, which is the point of authorising both on the seat.
            assertEquals(emptyList(), partiesSeatedIn(member))
            assertEquals(listOf("Baldrix", "mechyfechy"), standing(party))
        }
    }

    @Test
    fun `the account comes off the seat, so a seat left standing is not a way back in`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(owner, "Baldrix", position = 1)
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton", "Baldrix"))
            drop(party, night)

            assertTrue(leave(member, party))

            // The seat survives the leave (a week's roster points at it), so the binding is what
            // has to go. unlinkPerson makes the same move from the owner's end and for the same
            // reason: a revoke that leaves the seat bound looks like it worked.
            val mine = seat(party, "CreedBratton")!!
            assertNull(mine[PartyMember.linkedCharacterId])
            PartyMember.update({ PartyMember.id eq mine[PartyMember.id] }) { it[standing] = true }
            assertEquals(emptyList(), partiesSeatedIn(member))
        }
    }

    @Test
    fun `a night already played keeps the seat that ran it, and its roster`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(owner, "Baldrix", position = 1)
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton", "Baldrix"))
            drop(party, night)

            assertTrue(leave(member, party))

            // Retired, not deleted. A payout and a week's roster both reference the seat with ON
            // DELETE CASCADE, so deleting it would erase a debt in the same breath as a leave.
            val mine = seat(party, "CreedBratton")!!
            assertFalse(mine[PartyMember.standing])
            // And that week still says they were on it, so what fell is still divided by two.
            val ran =
                PartyWeekSeat
                    .selectAll()
                    .where {
                        (PartyWeekSeat.partyId eq Uuid.parse(party.id)) and
                            (PartyWeekSeat.weekStart eq weekOf(night))
                    }.map { it[PartyWeekSeat.memberId] }
            assertTrue(mine[PartyMember.id] in ran)
            assertEquals(3, ran.size)
        }
    }

    @Test
    fun `a seat nothing points at is deleted rather than left retired`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(owner, "Baldrix", position = 1)
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton", "Baldrix"))

            assertTrue(leave(member, party))

            // Nothing was ever played with them in it, so there is nothing to keep the row for.
            // retireOrDelete's rule, unchanged: a seat is kept because something points at it.
            assertNull(seat(party, "CreedBratton"))
        }
    }

    @Test
    fun `the split the people staying agreed is not re-cut`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(owner, "Baldrix", position = 1)
            link(owner, "Chris", member)
            // Somebody carries, which is what shares are for.
            val party = config(theirs, listOf("CreedBratton", "Baldrix"), mapOf("mechyfechy" to 3, "Baldrix" to 2))

            assertTrue(leave(member, party))

            // The roster is written through writeMembers, which reads a name it was given no share
            // for as taking one. Handing the shares back in is what stops a leave from quietly
            // re-cutting somebody else's money.
            assertEquals(3, seat(party, "mechyfechy")!![PartyMember.shares])
            assertEquals(2, seat(party, "Baldrix")!![PartyMember.shares])
        }
    }

    @Test
    fun `nobody else left demotes the config to the solo pool it now is`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            drop(party, night)

            assertTrue(leave(member, party))

            // #585's rule, reached from the other end: a party of one is not a party, and refusing
            // the leave instead would trap somebody in it. The pool is kept, which is the half that
            // matters, because deleting the config takes the drops with it.
            val config = Party.selectAll().where { Party.id eq Uuid.parse(party.id) }.single()
            assertTrue(config[Party.solo])
            assertEquals(1, lootFor(Uuid.parse(party.id)).size)
        }
    }

    @Test
    fun `the looter designation lapses with the seat`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(owner, "Baldrix", position = 1)
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton", "Baldrix"))
            val partyId = Uuid.parse(party.id)
            val mine = seat(party, "CreedBratton")!![PartyMember.id]
            Party.update({ Party.id eq partyId }) { it[looterMemberId] = mine }

            assertTrue(leave(member, party))

            // "If the seat leaves the party the designation lapses", V36's own words. Left standing
            // it would keep filing the party's pieces to somebody who is not in it.
            assertNull(Party.selectAll().where { Party.id eq partyId }.single()[Party.looterMemberId])
        }
    }

    @Test
    fun `a party I have no seat in is not mine to leave`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(stranger, "Nosy")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))

            // The one that matters. This is a write on somebody else's config, so a caller who is
            // not in it reaching the roster would reach every roster.
            assertFalse(leave(stranger, party))
            assertEquals(listOf("CreedBratton", "mechyfechy"), standing(party))
        }
    }

    @Test
    fun `a seat that only NAMES my character is not mine to leave`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            // No link, so nothing bound the seat: the owner typed a name that happens to be a real
            // character of somebody's. Reading it is refused for the same reason (SeatedPartiesTest),
            // and writing it would let anybody who picked the name edit the roster.
            val party = config(theirs, listOf("CreedBratton"))

            assertFalse(leave(member, party))
            assertEquals(listOf("CreedBratton", "mechyfechy"), standing(party))
        }
    }

    @Test
    fun `my own config is not a party I can leave`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))

            // Leaving your own config would be deleting it with the pool still hanging off it, and
            // DELETE /api/parties/{id} is that door, which retires rather than destroys.
            assertFalse(leave(owner, party))
            assertEquals(listOf("CreedBratton", "mechyfechy"), standing(party))
        }
    }
}
