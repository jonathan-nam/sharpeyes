package com.sharpeyes.backend.notifications

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.events.ACTOR
import com.sharpeyes.backend.parties.LootedDrop
import com.sharpeyes.backend.parties.PersonRequest
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SavePeopleRequest
import com.sharpeyes.backend.parties.addLoot
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.dropIdForKey
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.LocalDate
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.flywaydb.core.Flyway
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
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** A sale's bell entry names the Settlement card it lands on, for View Settlement. See PartyNotices.kt. */
class PartyNoticesTest {
    private val owner = "user_test_notices_owner"
    private val member = "user_test_notices_member"
    private val everyone = listOf(owner, member)

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
        cleanUp()
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            Party.deleteWhere { Party.userId inList everyone }
            Person.deleteWhere { Person.userId inList everyone }
            Characters.deleteWhere { Characters.userId inList everyone }
            Notification.deleteWhere { Notification.userId inList everyone }
        }
    }

    private fun character(
        userId: String,
        name: String,
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
            it[Characters.position] = 0
        }
        return id
    }

    /** The owner's party seating the member's character, its one drop, and the member's person row. */
    private fun soldDropBy(actor: String): Pair<Uuid, String> {
        val own = character(owner, "Thornwick")
        character(member, "Pellmoor")
        savePeople(owner, SavePeopleRequest(listOf(PersonRequest(null, "Pellmoor", emptyList()))), Clock.System.now())
        val person = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]
        Person.update({ Person.id eq person }) { it[linkedUserId] = member }
        val boss = bossIdForKey("kalos-the-guardian")!!
        val request = SavePartyRequest(own.toString(), "kalos-the-guardian", listOf("Pellmoor"), emptyMap())
        val party = createParty(owner, own, boss, request, Clock.System.now())
        val drop = LootedDrop(dropIdForKey("grindstone-of-faith")!!)
        addLoot(party, drop, boss, LocalDate.parse("2026-07-20"), Clock.System.now())
        val loot = allLootFor(owner).single { it.partyId == party.toString() }.loot.single()
        ACTOR.set(actor)
        try {
            noticeSale(party, loot)
        } finally {
            ACTOR.remove()
        }
        return person to (if (actor == owner) member else owner)
    }

    private fun personIdHeardBy(userId: String): String? =
        notificationsFor(userId)
            .notifications
            .single { it.kind == NotificationKind.SALE_RECORDED }
            .payload
            .jsonObject["personId"]
            ?.jsonPrimitive
            ?.content

    @Test
    fun `the owner's sale points the member at their card in the owner's book`() {
        transaction {
            val (person, heard) = soldDropBy(owner)
            assertEquals(person.toString(), personIdHeardBy(heard))
        }
    }

    @Test
    fun `a member's sale points the owner at that member's card`() {
        transaction {
            val (person, heard) = soldDropBy(member)
            assertEquals(person.toString(), personIdHeardBy(heard))
        }
    }
}
