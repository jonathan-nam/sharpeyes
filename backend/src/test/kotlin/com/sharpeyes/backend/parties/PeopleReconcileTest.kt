package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
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
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** What People says about a linked person's characters, and the seats a contested name never takes. */
class PeopleReconcileTest {
    private val owner = "user_test_reconcile_owner"
    private val member = "user_test_reconcile_member"
    private val stranger = "user_test_reconcile_stranger"
    private val everyone = listOf(owner, member, stranger, "user_test_reconcile_twin")

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

    private val twin = "user_test_reconcile_twin"

    /** Chris on [member]'s account and Ines on [twin]'s, both on the owner's People page. */
    private fun twoLinked(chris: List<String> = emptyList()) {
        savePeople(
            owner,
            SavePeopleRequest(listOf(PersonRequest(null, "Chris", chris), PersonRequest(null, "Ines", emptyList()))),
            Clock.System.now(),
        )
        for ((name, account) in listOf("Chris" to member, "Ines" to twin)) {
            val id = Person.selectAll().where { (Person.userId eq owner) and (Person.name eq name) }.single()[Person.id]
            Person.update({ Person.id eq id }) { it[linkedUserId] = account }
        }
    }

    private fun personNamed(name: String) = peopleFor(owner).single { it.name == name }

    @Test
    fun `a character filed under them that their account does not hold is said`() {
        transaction {
            character(member, "Pinewick")
            character(owner, "tidelark")
            twoLinked(chris = listOf("Pinewick", "GhostAlt"))
            assertEquals(listOf("GhostAlt"), personNamed("Chris").notOnAccount)
        }
    }

    @Test
    fun `a character two linked accounts hold is nobody's and takes no seat`() {
        transaction {
            ensureUser(twin, "$twin@example.com")
            val theirs = character(owner, "tidelark")
            character(member, "TwinChar")
            character(twin, "TwinChar")
            twoLinked()
            val party = config(theirs, listOf("TwinChar"))

            assertNull(seat(party, "TwinChar")!![PartyMember.linkedCharacterId])
            assertEquals(listOf("TwinChar"), personNamed("Chris").contested)
            assertEquals(listOf("TwinChar"), personNamed("Ines").contested)
            assertEquals(emptyList(), personNamed("Chris").ownedCharacters)
        }
    }

    @Test
    fun `a character one linked account holds still takes its seat`() {
        transaction {
            ensureUser(twin, "$twin@example.com")
            val theirs = character(owner, "tidelark")
            val pine = character(member, "Pinewick")
            twoLinked()
            val party = config(theirs, listOf("Pinewick"))

            assertEquals(pine, seat(party, "Pinewick")!![PartyMember.linkedCharacterId])
            assertEquals(emptyList(), personNamed("Chris").contested)
        }
    }
}
