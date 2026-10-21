package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
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

/** Who may write into a party: its owner and every member who has joined, and nobody else. */
class PartyAccessTest {
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

    /** The owner, Chris on [member]'s account seated as CraneBolton, and Baldrix nobody claims. */
    private fun shared(): PartyResponse {
        val theirs = character(owner, "mechobotto")
        character(member, "CraneBolton")
        link(owner, "Chris", member)
        return config(theirs, listOf("CraneBolton", "Baldrix"))
    }

    /** A Grindstone in [party]'s pool, logged by [by]. */
    private fun grindstone(
        party: PartyResponse,
        by: String,
    ): LootResponse {
        val id =
            addLoot(
                Uuid.parse(party.id),
                LootedDrop(dropIdForKey("grindstone-of-life")),
                bossIdForKey("kalos-the-guardian"),
                todayIn(Clock.System.now()),
                Clock.System.now(),
                LootSource(recordedBy = by),
            )
        return findLoot(id, Uuid.parse(party.id), by)!!
    }

    @Test
    fun `whoever logged a drop sells it, and nobody else`() {
        transaction {
            val party = shared()
            val crane = seat(party, "CraneBolton")!![PartyMember.id]
            val mecho = seat(party, "mechobotto")!![PartyMember.id]
            val theirs = grindstone(party, member)
            val ours = grindstone(party, owner)
            val partyId = Uuid.parse(party.id)

            assertNull(sellRefusal(partyId, member, crane, findLoot(Uuid.parse(theirs.id), partyId, member)!!))
            assertEquals(
                "Someone else logged this drop. They record its sale.",
                sellRefusal(partyId, member, crane, findLoot(Uuid.parse(ours.id), partyId, member)!!)?.refusal,
            )
            assertEquals(
                "Someone else logged this drop. They record its sale.",
                sellRefusal(partyId, owner, mecho, findLoot(Uuid.parse(theirs.id), partyId, owner)!!)?.refusal,
            )
        }
    }

    @Test
    fun `a member marks a share paid from either end of it, and no other`() {
        transaction {
            val party = shared()
            val crane = seat(party, "CraneBolton")!![PartyMember.id]
            val mecho = seat(party, "mechobotto")!![PartyMember.id]
            val baldrix = seat(party, "Baldrix")!![PartyMember.id]
            val partyId = Uuid.parse(party.id)
            val ownersSale = grindstone(party, owner).copy(sellerMemberId = mecho.toString())
            val membersSale = grindstone(party, member).copy(sellerMemberId = crane.toString())

            assertNull(payoutRefusal(partyId, member, crane, ownersSale), "owed to them")
            assertNull(payoutRefusal(partyId, member, mecho, membersSale), "sent by them")
            assertEquals(
                "You can only mark a share you sent or were sent.",
                payoutRefusal(partyId, member, baldrix, ownersSale)?.refusal,
            )
            assertNull(payoutRefusal(partyId, owner, baldrix, ownersSale))
        }
    }

    @Test
    fun `the owner's own pools say which drops a member logged`() {
        transaction {
            val party = shared()
            val theirs = grindstone(party, member)
            val ours = grindstone(party, owner)

            val read = allLootFor(owner).single().loot.associate { it.id to it.recordedByYou }
            assertEquals(mapOf(theirs.id to false, ours.id to true), read)
            val asMember = allLootFor(owner, viewer = member).single().loot.associate { it.id to it.recordedByYou }
            assertEquals(mapOf(theirs.id to true, ours.id to false), asMember)
            // Named as each viewer calls the other: the owner's person row for Chris, and the owner's
            // main for a member with no person of their own for them. Your own drop names nobody.
            val names = allLootFor(owner).single().loot.associate { it.id to it.recordedByName }
            assertEquals(mapOf(theirs.id to "Chris", ours.id to null), names)
            val namesAsMember =
                allLootFor(
                    owner,
                    viewer = member,
                ).single().loot.associate { it.id to it.recordedByName }
            assertEquals(mapOf(theirs.id to null, ours.id to "mechobotto"), namesAsMember)
        }
    }

    @Test
    fun `a member who has joined may write, and sees the seats they act as`() {
        transaction {
            val party = shared()
            assertTrue(canEditParty(Uuid.parse(party.id), member))
            val craneSeat = seat(party, "CraneBolton")!![PartyMember.id].toString()
            assertEquals(listOf(craneSeat), findParty(Uuid.parse(party.id), member)!!.yourSeats)
            assertEquals(emptyList(), findParty(Uuid.parse(party.id), owner)!!.yourSeats)
        }
    }

    @Test
    fun `nobody else may, and nobody else learns the party exists`() {
        transaction {
            val party = shared()
            character(stranger, "Nobody")
            assertFalse(canEditParty(Uuid.parse(party.id), stranger))
            assertNull(findParty(Uuid.parse(party.id), stranger))
        }
    }

    @Test
    fun `the owner may`() {
        transaction {
            val party = shared()
            assertTrue(canEditParty(Uuid.parse(party.id), owner))
        }
    }

    @Test
    fun `leaving ends it`() {
        transaction {
            val party = shared()
            assertTrue(leaveParty(member, Uuid.parse(party.id), Clock.System.now()))
            assertFalse(canEditParty(Uuid.parse(party.id), member))
        }
    }

    @Test
    fun `unlinking ends it`() {
        transaction {
            val party = shared()
            val chris = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]
            assertTrue(unlinkPerson(owner, chris))
            assertFalse(canEditParty(Uuid.parse(party.id), member))
        }
    }

    @Test
    fun `a seat with no account behind it grants nothing`() {
        transaction {
            val party = shared()
            PartyMember.update({ PartyMember.id eq seat(party, "CraneBolton")!![PartyMember.id] }) {
                it[linkedCharacterId] = null
            }
            assertFalse(canEditParty(Uuid.parse(party.id), member))
        }
    }
}
