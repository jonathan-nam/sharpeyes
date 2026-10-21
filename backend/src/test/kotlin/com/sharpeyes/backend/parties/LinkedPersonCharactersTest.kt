package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.sprites.spriteProxyPath
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
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

/**
 * Who a seat belongs to, when that person has an account of their own.
 *
 * person_character is the account owner's answer to "whose character is this", typed one name at a
 * time. Once that person accepts an invite, their own account can answer it instead, and their
 * answer is not a second opinion: it is the character actually sitting on their roster.
 *
 * The claim worth a database is that BOTH readers agree. The People page and the seat under it
 * resolve the same name through the same rule, or one screen owes a share to somebody the other
 * has never heard of, which is a wrong number that looks exactly like a right one.
 */
class LinkedPersonCharactersTest {
    private val mine = "user_test_linked_mine"
    private val theirs = "user_test_linked_theirs"

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
            Party.deleteWhere { (Party.userId eq mine) or (Party.userId eq theirs) }
            Person.deleteWhere { (Person.userId eq mine) or (Person.userId eq theirs) }
            Characters.deleteWhere { (Characters.userId eq mine) or (Characters.userId eq theirs) }
        }
    }

    private fun character(
        userId: String,
        name: String,
        world: String = WORLD_INTERACTIVE,
        position: Int = 0,
        sprite: String? = null,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[Characters.worldType] = world
            it[spriteImgUrl] = sprite
            it[createdAt] = now
            it[updatedAt] = now
            it[Characters.position] = position
        }
        return id
    }

    /**
     * MY whole people list, by name, saved in one go.
     *
     * All of them at once because savePeople REPLACES the list rather than adding to it: calling
     * it once per person leaves only the last one, and the test that found this out read as a
     * missing person rather than as a helper that had deleted them.
     */
    private fun people(vararg rows: Pair<String, List<String>>): Map<String, Uuid> {
        val request = SavePeopleRequest(rows.map { PersonRequest(null, it.first, it.second) })
        savePeople(mine, request, Clock.System.now())
        return Person
            .selectAll()
            .where { Person.userId eq mine }
            .associate { it[Person.name] to it[Person.id] }
    }

    /** Records that this person signs in as [account], which is what accepting an invite writes. */
    private fun link(
        personId: Uuid,
        account: String,
    ) {
        Person.update({ Person.id eq personId }) { it[linkedUserId] = account }
    }

    /** One config of mine seating [members] beside my own character. */
    private fun config(
        ownCharacter: Uuid,
        members: List<String>,
    ): PartyResponse {
        val request = SavePartyRequest(ownCharacter.toString(), "kalos-the-guardian", members)
        val id = createParty(mine, ownCharacter, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
        return findParty(id, mine)!!
    }

    @Test
    fun `a linked person brings the characters their own account holds`() {
        transaction {
            val own = character(mine, "tidelark")
            character(theirs, "Pinewick")
            // Nothing attributed by hand. Before the link this seat belonged to nobody.
            val chris = people("Chris" to emptyList()).getValue("Chris")
            link(chris, theirs)
            val party = config(own, listOf("Pinewick"))

            assertEquals(listOf("Pinewick"), peopleFor(mine).single().ownedCharacters)
            assertEquals(emptyList(), peopleFor(mine).single().characters)
            // And the seat says so without anyone having said it.
            assertEquals("Chris", party.members[1].personName)
            assertEquals(chris.toString(), party.members[1].personId)
        }
    }

    @Test
    fun `an unlinked person is unchanged, and still whatever this account said`() {
        transaction {
            val own = character(mine, "tidelark")
            people("Dwight" to listOf("Schrute"))
            val party = config(own, listOf("Schrute"))

            val dwight = peopleFor(mine).single()
            assertEquals(listOf("Schrute"), dwight.characters)
            assertEquals(emptyList(), dwight.ownedCharacters)
            assertEquals("Dwight", party.members[1].personName)
        }
    }

    @Test
    fun `their roster is theirs, and only what this account already seats comes across`() {
        transaction {
            val own = character(mine, "tidelark")
            character(theirs, "Pinewick", position = 0)
            // A mule of theirs that has never been in one of my parties. Linking is not a window
            // onto their account, it is an answer to a question I had already asked.
            character(theirs, "PinesMule", position = 1)
            link(people("Chris" to emptyList()).getValue("Chris"), theirs)
            config(own, listOf("Pinewick"))

            assertEquals(listOf("Pinewick"), peopleFor(mine).single().ownedCharacters)
        }
    }

    @Test
    fun `their account's answer beats what this one guessed`() {
        transaction {
            val own = character(mine, "tidelark")
            character(theirs, "Pinewick")
            // I said Pinewick was Dwight's. Chris's account says it is his, and it is his
            // account: the guess loses to the character actually sitting on a roster.
            val ids = people("Dwight" to listOf("Pinewick"), "Chris" to emptyList())
            val chris = ids.getValue("Chris")
            link(chris, theirs)
            val party = config(own, listOf("Pinewick"))

            assertEquals(chris.toString(), party.members[1].personId)
            assertEquals("Chris", party.members[1].personName)
            // The attribution is left in the database rather than deleted behind my back. It is
            // still the answer if the link ever goes away.
            val dwight = peopleFor(mine).single { it.name == "Dwight" }
            assertEquals(listOf("Pinewick"), dwight.characters)
        }
    }

    @Test
    fun `a character in the other world is not the seat in front of you`() {
        transaction {
            val own = character(mine, "tidelark")
            // Same name, their account, wrong world. Narrowing by world is what every other
            // account-wide read does, and a party is in one world.
            character(theirs, "Pinewick", world = WORLD_HEROIC)
            link(people("Chris" to emptyList()).getValue("Chris"), theirs)
            config(own, listOf("Pinewick"))

            assertEquals(emptyList(), peopleFor(mine).single().ownedCharacters)
        }
    }

    @Test
    fun `a seat that is their real character points at it`() {
        transaction {
            val own = character(mine, "tidelark")
            val theirCharacter = character(theirs, "Pinewick")
            link(people("Chris" to emptyList()).getValue("Chris"), theirs)
            val party = config(own, listOf("Pinewick"))

            val seat = party.members[1]
            assertEquals(theirCharacter.toString(), seat.linkedCharacterId)
            // NOT characterId. That one means the seat is one of MINE, and the coupon ledger reads
            // a non-null value as SELF: setting it here would report their pieces as my own.
            assertNull(seat.characterId)
        }
    }

    @Test
    fun `my own seat is mine and is not a linked one`() {
        transaction {
            val own = character(mine, "tidelark")
            val party = config(own, listOf("Steve"))

            val me = party.members[0]
            assertEquals(own.toString(), me.characterId)
            assertNull(me.linkedCharacterId)
        }
    }

    @Test
    fun `a seat that is only a name points at nothing`() {
        transaction {
            val own = character(mine, "tidelark")
            // Attributed by hand to somebody with no account. A name is all this seat has ever
            // been, and stage one does not change that.
            people("Dwight" to listOf("Schrute"))
            val party = config(own, listOf("Schrute"))

            assertEquals("Dwight", party.members[1].personName)
            assertNull(party.members[1].linkedCharacterId)
        }
    }

    @Test
    fun `their account's sprite beats this account's copy of it`() {
        transaction {
            val own = character(mine, "tidelark")
            character(theirs, "Pinewick", sprite = "https://nexon.example/pine-now.png")
            link(people("Chris" to emptyList()).getValue("Chris"), theirs)
            val party = config(own, listOf("Pinewick"))
            // A copy this account looked up earlier, which is what the seat would otherwise show.
            // Their account refreshes the character's own sprite, so the copy is the stale one.
            PartyMember.update({ PartyMember.id eq Uuid.parse(party.members[1].id) }) {
                it[spriteImgUrl] = "https://nexon.example/pine-stale.png"
            }

            val seat = findParty(Uuid.parse(party.id), mine)!!.members[1]
            assertEquals(spriteProxyPath("https://nexon.example/pine-now.png"), seat.spriteImgUrl)
        }
    }

    @Test
    fun `a seat with no character behind it still shows the copy`() {
        transaction {
            val own = character(mine, "tidelark")
            val party = config(own, listOf("Schrute"))
            PartyMember.update({ PartyMember.id eq Uuid.parse(party.members[1].id) }) {
                it[spriteImgUrl] = "https://nexon.example/schrute.png"
            }

            // Nothing better exists for a name nobody's account holds, and a copy beats an empty
            // frame. Only a real character row displaces it.
            val seat = findParty(Uuid.parse(party.id), mine)!!.members[1]
            assertEquals(spriteProxyPath("https://nexon.example/schrute.png"), seat.spriteImgUrl)
        }
    }
}
