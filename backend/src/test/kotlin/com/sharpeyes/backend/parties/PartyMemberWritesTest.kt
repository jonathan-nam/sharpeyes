package com.sharpeyes.backend.parties

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
}
