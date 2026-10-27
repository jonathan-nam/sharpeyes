package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyReadCutoff
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.friends.seatCharacters
import com.sharpeyes.backend.pages.sharedBooksFor
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
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** Two linked owners who each keep a party for the same night. See StandingParties.kt. */
class OverlappingPartiesTest {
    private val xan = "user_test_overlap_xan"
    private val yew = "user_test_overlap_yew"
    private val everyone = listOf(xan, yew)
    private val kalos = "kalos-the-guardian"

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
            it[worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun party(
        owner: String,
        own: Uuid,
        vararg members: String,
    ): Uuid {
        val request = SavePartyRequest(own.toString(), kalos, members.toList())
        return createParty(owner, own, bossIdForKey(kalos)!!, request, Clock.System.now())
    }

    /** Each a linked person on the other's list, as accepting a friend request leaves them. */
    private fun link() {
        for ((of, other) in listOf(xan to yew, yew to xan)) {
            savePeople(of, SavePeopleRequest(listOf(PersonRequest(null, "Friend", emptyList()))), Clock.System.now())
            Person.update({ Person.userId eq of }) { it[linkedUserId] = other }
        }
    }

    private fun drop(
        partyId: Uuid,
        on: LocalDate,
    ): String {
        val id = Uuid.random()
        val now = Clock.System.now()
        PartyLoot.insert {
            it[PartyLoot.id] = id
            it[PartyLoot.partyId] = partyId
            it[customName] = "Grindstone of Faith"
            it[droppedOn] = on
            it[quantity] = 1
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id.toString()
    }

    private fun thisPeriod(): LocalDate {
        val boss = bossIdForKey(kalos)!!
        val reset = BossCatalog.selectAll().where { BossCatalog.id eq boss }.single()[BossCatalog.reset]
        return periodStartFor(reset, Clock.System.now())
    }

    /** The loot ids [reader] sees of [owner]'s book. */
    private fun readAcross(
        reader: String,
        owner: String,
    ): Set<String> =
        sharedBooksFor(reader)
            .filter { book ->
                book.parties.any { party ->
                    Party.selectAll().where { Party.id eq Uuid.parse(party.id) }.single()[Party.userId] ==
                        owner
                }
            }.flatMap { book -> book.pools.flatMap { pool -> pool.loot.map { it.id } } }
            .toSet()

    private fun seatOf(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .single()

    @Test
    fun `linking binds neither copy, and neither is read across`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Thornwick")
            drop(mine, thisPeriod())
            drop(theirs, thisPeriod())
            link()
            seatCharacters(yew)
            seatCharacters(xan)

            // Each already runs Kalos in a party of their own.
            assertNull(seatOf(mine, "Pellmoor")[PartyMember.linkedCharacterId])
            assertNull(seatOf(theirs, "Thornwick")[PartyMember.linkedCharacterId])
            // Both books hold this night: reading the other's copy too would count it twice.
            assertEquals(emptySet(), readAcross(yew, xan))
            assertEquals(emptySet(), readAcross(xan, yew))
        }
    }

    @Test
    fun `a party combined before combining was removed still reads from its cutoff`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Thornwick")
            val before = thisPeriod().let { LocalDate.fromEpochDays(it.toEpochDays() - 7) }
            drop(mine, before)
            drop(theirs, before)
            link()
            // What an accepted combine (V98) left behind: theirs retired, Pellmoor bound into mine.
            Party.update({ Party.id eq theirs }) { it[standing] = false }
            PartyMember.update({ PartyMember.partyId eq theirs }) { it[linkedCharacterId] = null }
            PartyMember.update({ (PartyMember.partyId eq mine) and (PartyMember.name eq "Pellmoor") }) {
                it[linkedCharacterId] = pell
            }
            PartyReadCutoff.insert {
                it[partyId] = mine
                it[userId] = yew
                it[sharedFrom] = thisPeriod()
            }
            PartyReadCutoff.insert {
                it[partyId] = theirs
                it[userId] = xan
                it[sharedFrom] = null
            }
            val myNew = drop(mine, thisPeriod())

            assertEquals(setOf(myNew), readAcross(yew, xan))
            assertEquals(emptySet(), readAcross(xan, yew))
        }
    }
}
