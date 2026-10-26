package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.AddLootRequest
import com.sharpeyes.api.loot.LootResponse
import com.sharpeyes.api.loot.SellLootRequest
import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
import com.sharpeyes.api.system.Refusal
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** What a member may write into a pool they do not own, and the guard against logging a night twice. */
class PartyMemberWritesTest {
    private val owner = "user_test_editors_owner"
    private val member = "user_test_editors_member"
    private val stranger = "user_test_editors_stranger"
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

    private val night = LocalDate.parse("2026-07-20")
    private val now = Clock.System.now()

    private fun drop(
        party: PartyResponse,
        on: LocalDate = night,
        by: String? = null,
        key: String = "grindstone-of-faith",
    ): Uuid =
        addLoot(
            Uuid.parse(party.id),
            LootedDrop(dropIdForKey(key)!!),
            bossIdForKey("kalos-the-guardian"),
            on,
            now,
            LootSource(recordedBy = by),
        )

    private fun id(party: PartyResponse) = Uuid.parse(party.id)

    private fun seatId(
        party: PartyResponse,
        name: String,
    ) = seat(party, name)!![PartyMember.id]

    private fun loot(
        party: PartyResponse,
        lootId: Uuid,
        viewer: String = member,
    ) = findLoot(lootId, id(party), viewer)!!

    private fun sell(
        party: PartyResponse,
        lootId: Uuid,
        seller: String,
    ) {
        val sellerId = seatId(party, seller)
        sellLoot(
            lootId,
            SellLootRequest(1_000_000_000, "LISTED", "FAIR", sellerId.toString()),
            sellerId,
            id(party),
            now,
        )
    }

    /** The owner, Chris on [member]'s account as Pinewick, and Baldrix unclaimed. */
    private fun shared(): PartyResponse {
        val theirs = character(owner, "tidelark")
        character(member, "Pinewick")
        link(owner, "Chris", member)
        val party = config(theirs, listOf("Pinewick", "Baldrix"))
        return party
    }

    @Test
    fun `a second logging of one drop in one week is caught, a different week or drop is not`() {
        transaction {
            val party = shared()
            drop(party)
            val item = LootedDrop(dropIdForKey("grindstone-of-faith")!!)
            val boss = bossIdForKey("kalos-the-guardian")
            assertNotNull(duplicateRefusal(id(party), item, boss, night.plus(1, DateTimeUnit.DAY)))
            assertNull(duplicateRefusal(id(party), item, boss, night.plus(7, DateTimeUnit.DAY)))
            assertNull(duplicateRefusal(id(party), LootedDrop(dropIdForKey("grindstone-of-life")!!), boss, night))
        }
    }

    @Test
    fun `a catalog drop is logged once a week, and Add Again cannot log it twice`() {
        transaction {
            val party = shared()
            val vestiges = AddLootRequest(dropKey = "vestige-of-erion", quantity = 180, again = true)
            val item = LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 180)
            val boss = bossIdForKey("kalos-the-guardian")
            val add = { by: String, days: Int ->
                addPoolDrop(id(party), by, item, boss, night.plus(days, DateTimeUnit.DAY), vestiges)
            }
            assertTrue(add(member, 0) is LootResponse)
            assertTrue(add(owner, 1) is Refusal)
            assertTrue(add(owner, 7) is LootResponse)
            // Every other catalog drop too, and only ever one of it.
            val faith = AddLootRequest(dropKey = "grindstone-of-faith", again = true)
            val grindstone = LootedDrop(dropIdForKey("grindstone-of-faith")!!)
            val two = LootedDrop(dropIdForKey("grindstone-of-faith")!!, quantity = 2)
            assertTrue(addPoolDrop(id(party), member, two, boss, night, faith) is Refusal)
            assertTrue(addPoolDrop(id(party), member, grindstone, boss, night, faith) is LootResponse)
            assertTrue(addPoolDrop(id(party), owner, grindstone, boss, night, faith) is Refusal)
        }
    }

    @Test
    fun `a typed drop can still be added again when asked`() {
        transaction {
            val party = shared()
            val box = LootedDrop(null, "Mystery Box")
            val boss = bossIdForKey("kalos-the-guardian")
            val once = AddLootRequest(customName = "Mystery Box")
            assertTrue(addPoolDrop(id(party), member, box, boss, night, once) is LootResponse)
            assertTrue(addPoolDrop(id(party), member, box, boss, night, once) is Duplicate)
            assertTrue(addPoolDrop(id(party), member, box, boss, night, once.copy(again = true)) is LootResponse)
        }
    }

    @Test
    fun `a typed drop is matched on its name, whatever the case`() {
        transaction {
            val party = shared()
            addLoot(id(party), LootedDrop(null, "Mystery Box"), bossIdForKey("kalos-the-guardian"), night, now)
            assertNotNull(duplicateRefusal(id(party), LootedDrop(null, "mystery box"), null, night))
        }
    }

    @Test
    fun `a member sells as themselves and never as somebody else`() {
        transaction {
            val party = shared()
            val lootId = drop(party, by = member)
            val row = loot(party, lootId)
            assertNull(sellRefusal(id(party), member, seatId(party, "Pinewick"), row))
            assertNotNull(sellRefusal(id(party), member, seatId(party, "tidelark"), row))
            assertNotNull(sellRefusal(id(party), member, seatId(party, "Baldrix"), row))
            assertNull(sellRefusal(id(party), owner, seatId(party, "Baldrix"), row))
        }
    }

    @Test
    fun `a member cannot correct or undo a sale that was not theirs`() {
        transaction {
            val party = shared()
            val lootId = drop(party)
            sell(party, lootId, "tidelark")
            val row = loot(party, lootId)
            assertNotNull(sellRefusal(id(party), member, seatId(party, "Pinewick"), row))
            assertNotNull(unsellRefusal(id(party), member, row))
            assertNull(unsellRefusal(id(party), owner, row))
        }
    }

    @Test
    fun `a member undoes their own sale`() {
        transaction {
            val party = shared()
            val lootId = drop(party, by = member)
            sell(party, lootId, "Pinewick")
            assertNull(unsellRefusal(id(party), member, loot(party, lootId)))
        }
    }

    @Test
    fun `a member marks a drop kept by themselves only, and puts back only their own`() {
        transaction {
            val party = shared()
            val lootId = drop(party)
            val row = loot(party, lootId)
            assertNull(keptRefusal(id(party), member, seatId(party, "Pinewick"), row))
            assertNotNull(keptRefusal(id(party), member, seatId(party, "tidelark"), row))
            PartyLoot.update({ PartyLoot.id eq lootId }) { it[takenByMemberId] = seatId(party, "tidelark") }
            assertNotNull(keptRefusal(id(party), member, null, loot(party, lootId)))
        }
    }

    @Test
    fun `a member deletes only an unsold drop they logged`() {
        transaction {
            val party = shared()
            val theirs = drop(party, by = member)
            val ownersDrop = drop(party, key = "grindstone-of-life")
            assertTrue(loot(party, theirs).recordedByYou)
            assertFalse(loot(party, ownersDrop).recordedByYou)
            assertTrue(mayDeleteLoot(id(party), member, loot(party, theirs)))
            assertFalse(mayDeleteLoot(id(party), member, loot(party, ownersDrop)))
            assertTrue(mayDeleteLoot(id(party), owner, loot(party, theirs, owner)))
            sell(party, theirs, "Pinewick")
            assertFalse(mayDeleteLoot(id(party), member, loot(party, theirs)))
        }
    }

    @Test
    fun `a member sets the split, and nothing else of the party moves`() {
        transaction {
            val party = shared()
            assertTrue(canEditParty(id(party), member))
            assertFalse(canEditParty(id(party), stranger))
            val mine = seatId(party, "Pinewick")
            assertNull(saveSplit(id(party), mapOf(mine to 2), now))
            assertTrue(seat(party, "Pinewick")!![PartyMember.shares] == 2)
            // A seat left out keeps what it takes.
            assertTrue(seat(party, "tidelark")!![PartyMember.shares] == 1)
            assertTrue(findParty(id(party), owner)!!.members.map { it.name } == party.members.map { it.name })
        }
    }

    @Test
    fun `a split naming a stranger, a bad count or nobody at all is refused`() {
        transaction {
            val party = shared()
            val everySeat = party.members.map { Uuid.parse(it.id) }
            assertNotNull(saveSplit(id(party), mapOf(Uuid.random() to 1), now))
            assertNotNull(saveSplit(id(party), mapOf(seatId(party, "Pinewick") to MAX_SHARES + 1), now))
            assertNotNull(saveSplit(id(party), everySeat.associateWith { 0 }, now))
            assertTrue(seat(party, "Pinewick")!![PartyMember.shares] == 1)
        }
    }

    @Test
    fun `a member edits the config as its owner, and reads the answer as themselves`() {
        transaction {
            val party = shared()
            assertTrue(keeperOf(id(party), member) == owner)
            assertTrue(keeperOf(id(party), owner) == owner)
            assertNull(keeperOf(id(party), stranger))
            val request = SavePartyRequest(party.characterId, party.bossKey, listOf("Pinewick", "Baldrix", "Quillon"))
            saveParty(keeperOf(id(party), member)!!, id(party), request, now, emptyMap())
            // Pinewick stays the member's linked seat rather than becoming one of the owner's characters.
            assertNull(seat(party, "Pinewick")!![PartyMember.characterId])
            assertNotNull(seat(party, "Quillon"))
            val answer = findParty(id(party), owner).seenBy(id(party), member, owner) as PartyResponse
            assertFalse(answer.yours)
        }
    }

    @Test
    fun `a drop a member logs comes back in the pools of the parties they sit in`() {
        transaction {
            val party = shared()
            val lootId = drop(party, by = member)
            val pool = seatedPoolsFor(member).single { it.partyId == party.id }
            assertTrue(pool.loot.single().id == lootId.toString())
            assertTrue(pool.loot.single().recordedByYou)
            ensureUser(stranger, "$stranger@example.com")
            assertTrue(seatedPoolsFor(stranger).isEmpty())
        }
    }

    @Test
    fun `a member reads a joined pool from when they were linked, and counts it from their own seats`() {
        transaction {
            val party = shared()
            Person.update({ Person.userId eq owner }) { it[sharedFrom] = night.plus(1, DateTimeUnit.DAY) }
            drop(party)
            val after = drop(party, on = night.plus(7, DateTimeUnit.DAY), key = "grindstone-of-life")
            assertTrue(seatedPoolsFor(member).single().loot.map { it.id } == listOf(after.toString()))
            assertTrue(lootFor(id(party), member).readBy(member, id(party)).size == 1)
            // The owner reads all of it.
            assertTrue(lootFor(id(party), owner).readBy(owner, id(party)).size == 2)
            assertTrue(readerSeatsIn(listOf(id(party)), member) == setOf(seatId(party, "Pinewick")))
            assertTrue(readerSeatsIn(listOf(id(party)), owner) == setOf(seatId(party, "tidelark")))
        }
    }

    @Test
    fun `only the owner invites, and a member's Drop Log drop is sent to the party`() {
        transaction {
            val party = shared()
            val friend = listOf(Invitee("Quillon", Uuid.random()))
            assertNotNull(memberInviteRefusal(member, owner, friend))
            assertNull(memberInviteRefusal(owner, owner, friend))
            assertNull(memberInviteRefusal(member, owner, emptyList()))
            val pinewick = Characters.selectAll().where { Characters.userId eq member }.single()[Characters.id]
            assertTrue(seatedPartyFor(pinewick, bossIdForKey("kalos-the-guardian")!!) == id(party))
        }
    }
}
