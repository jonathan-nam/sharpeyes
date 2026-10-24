package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyCombine
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.friends.seatCharacters
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notificationsFor
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
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** Two linked owners who each kept a party for the same night. See CombineParties.kt. */
class CombinePartiesTest {
    private val xan = "user_test_combine_xan"
    private val yew = "user_test_combine_yew"
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

    private fun proposalFor(partyId: Uuid) =
        PartyCombine.selectAll().where { PartyCombine.keepPartyId eq partyId }.toList()

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
        val reset =
            BossCatalog
                .selectAll()
                .where {
                    BossCatalog.id eq
                        bossIdForKey(
                            kalos,
                        )!!
                }.single()[BossCatalog.reset]
        return periodStartFor(reset, Clock.System.now())
    }

    private fun nextPeriod(): LocalDate {
        val reset =
            BossCatalog
                .selectAll()
                .where {
                    BossCatalog.id eq
                        bossIdForKey(
                            kalos,
                        )!!
                }.single()[BossCatalog.reset]
        return periodAfter(reset, thisPeriod())
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
    fun `combining needs both owners, then shares the kept party from the cutoff and reads none of the other`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Thornwick")
            val before = thisPeriod().let { LocalDate.fromEpochDays(it.toEpochDays() - 7) }
            val myOld = drop(mine, before)
            val theirOld = drop(theirs, before)
            link()
            seatCharacters(yew)
            seatCharacters(xan)

            // Linking alone binds neither: each already runs Kalos in a party of their own.
            assertNull(seatOf(mine, "Pellmoor")[PartyMember.linkedCharacterId])
            assertNull(seatOf(theirs, "Thornwick")[PartyMember.linkedCharacterId])
            val pair = combinablePairs(xan).single()
            assertEquals(setOf(mine, theirs), pair.keepable.toSet())
            // The double count: Yew's own book has this night, and reads Xan's copy of it too.
            assertEquals(setOf(myOld), readAcross(yew, xan))
            assertEquals(setOf(theirOld), readAcross(xan, yew))

            assertIs<CombineAnswer.Done>(proposeCombine(xan, mine, theirs, Clock.System.now()))
            val proposal = proposalFor(mine).single()[PartyCombine.id]
            assertEquals(NotificationKind.PARTY_COMBINE, notificationsFor(yew).notifications.single().kind)
            // The one who asked cannot answer for the other owner.
            assertIs<CombineAnswer.NotFound>(acceptCombine(xan, proposal, Clock.System.now()))

            assertIs<CombineAnswer.Done>(acceptCombine(yew, proposal, Clock.System.now()))
            val myNew = drop(mine, thisPeriod())

            val retired = Party.selectAll().where { Party.id eq theirs }.single()
            assertFalse(retired[Party.standing])
            assertEquals(mine, retired[Party.combinedInto])
            assertEquals(pell, seatOf(mine, "Pellmoor")[PartyMember.linkedCharacterId])
            // Before the cutoff each book is its own: Yew reads only the new drop of the kept party,
            // and Xan reads nothing of the retired one.
            assertEquals(setOf(myNew), readAcross(yew, xan))
            assertEquals(emptySet(), readAcross(xan, yew))
            assertEquals(emptyList(), notificationsFor(yew).notifications)
            assertEquals(listOf(NotificationKind.PARTY_COMBINED), notificationsFor(xan).notifications.map { it.kind })
            assertEquals(emptyList(), combinablePairs(xan))
        }
    }

    @Test
    fun `the cutoff is the next reset when both pools already logged this period`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Thornwick")
            val kalosId = bossIdForKey(kalos)!!

            assertEquals(thisPeriod(), cutoffFor(mine, theirs, kalosId, Clock.System.now()))
            drop(mine, thisPeriod())
            assertEquals(thisPeriod(), cutoffFor(mine, theirs, kalosId, Clock.System.now()))
            drop(theirs, thisPeriod())
            assertEquals(nextPeriod(), cutoffFor(mine, theirs, kalosId, Clock.System.now()))
        }
    }

    @Test
    fun `only the party already seating the other owner can be kept`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Larkspur")
            link()

            assertEquals(listOf(mine), combinablePairs(xan).single().keepable)
            assertIs<CombineAnswer.Refused>(proposeCombine(xan, theirs, mine, Clock.System.now()))
            assertEquals(emptyList(), proposalFor(theirs))
        }
    }

    @Test
    fun `declining clears the proposal and its notification`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Thornwick")
            link()
            proposeCombine(xan, mine, theirs, Clock.System.now())
            val proposal = proposalFor(mine).single()[PartyCombine.id]

            assertEquals(true, dropCombine(yew, proposal))

            assertEquals(emptyList(), proposalFor(mine))
            assertEquals(emptyList(), notificationsFor(yew).notifications)
            assertEquals(true, Party.selectAll().where { Party.id eq theirs }.single()[Party.standing])
        }
    }
}
