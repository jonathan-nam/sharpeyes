package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyCombineItem
import com.sharpeyes.backend.db.PartyCombineRequest
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

    /** [of]'s person row for the other account. */
    private fun friendOf(of: String) = Person.selectAll().where { Person.userId eq of }.single()[Person.id]

    /** The request [from] sent, if any, and its items as keep to retire. */
    private fun requestFrom(from: String): Pair<Uuid, Map<Uuid, Uuid>>? {
        val id =
            PartyCombineRequest
                .selectAll()
                .where { PartyCombineRequest.fromUserId eq from }
                .firstOrNull()
                ?.get(PartyCombineRequest.id) ?: return null
        val items =
            PartyCombineItem
                .selectAll()
                .where { PartyCombineItem.requestId eq id }
                .associate { it[PartyCombineItem.keepPartyId] to it[PartyCombineItem.retirePartyId] }
        return id to items
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

            // The same people on both sides: no conflict, and the sender's copy is kept.
            assertIs<CombineAnswer.Done>(sendCombine(xan, friendOf(xan), emptyList(), emptyList(), Clock.System.now()))
            val (proposal, items) = requestFrom(xan)!!
            assertEquals(mapOf(mine to theirs), items)
            assertEquals(NotificationKind.PARTY_COMBINE, notificationsFor(yew).notifications.single().kind)
            // Yew answers the one request rather than being offered to send one back.
            val page = combinePage(yew, Clock.System.now())
            assertEquals(listOf(1 to 1), page.incoming.map { it.total to it.keepsTheirs })
            assertEquals(emptyList(), page.friends)
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
    fun `a pair only one side can keep settles itself, whatever the sender chose`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Larkspur")
            link()

            assertEquals(listOf(mine), combinablePairs(xan).single().keepable)
            val wrong = CombineChoice(mine, theirs, keep = theirs)
            assertIs<CombineAnswer.Done>(
                sendCombine(xan, friendOf(xan), listOf(wrong), emptyList(), Clock.System.now()),
            )
            assertEquals(mapOf(mine to theirs), requestFrom(xan)!!.second)
        }
    }

    @Test
    fun `a conflict needs the sender's answer, and the answer is what is sent`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            // Both seat each other, but Xan's has a third seat Yew's does not.
            val mine = party(xan, thorn, "Pellmoor", "Larkspur")
            val theirs = party(yew, pell, "Thornwick")
            link()
            val friend = friendOf(xan)

            assertEquals(1, planWith(xan, yew).conflicts.size)
            assertIs<CombineAnswer.Refused>(sendCombine(xan, friend, emptyList(), emptyList(), Clock.System.now()))
            assertNull(requestFrom(xan))

            val keepTheirs = CombineChoice(mine, theirs, keep = theirs)
            assertIs<CombineAnswer.Done>(sendCombine(xan, friend, listOf(keepTheirs), emptyList(), Clock.System.now()))
            assertEquals(mapOf(theirs to mine), requestFrom(xan)!!.second)
        }
    }

    @Test
    fun `a character left in two parties stays in the one the sender chose, and only that one`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val quill = character(xan, "Quillon")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            // Larkspur runs Kalos in another of Xan's parties, and Yew lists them too.
            val other = party(xan, quill, "Larkspur")
            val theirs = party(yew, pell, "Thornwick", "Larkspur")
            link()
            val friend = friendOf(xan)
            val keepTheirs = listOf(CombineChoice(mine, theirs, keep = theirs))

            // Keeping Xan's copy retires the only other party holding Larkspur, so nothing is left.
            assertEquals(emptyList(), previewCombine(xan, friend, listOf(CombineChoice(mine, theirs, keep = mine))))
            // Keeping Yew's leaves Larkspur in it and in Xan's other party, and either can keep them.
            val clash = previewCombine(xan, friend, keepTheirs)!!.single()
            assertEquals("Larkspur", clash.name)
            assertEquals(setOf(other, theirs), clash.options.map { it.id }.toSet())
            assertIs<CombineAnswer.Refused>(sendCombine(xan, friend, keepTheirs, emptyList(), Clock.System.now()))

            val stayInMine = listOf(SeatChoice("Larkspur", other))
            assertIs<CombineAnswer.Done>(sendCombine(xan, friend, keepTheirs, stayInMine, Clock.System.now()))
            assertEquals(listOf("Larkspur"), incomingTakesOut(yew))

            assertIs<CombineAnswer.Done>(acceptCombine(yew, requestFrom(xan)!!.first, Clock.System.now()))
            assertEquals(emptyList(), clashesIn(standingParties(listOf(xan, yew))))
            assertFalse(standingParties(listOf(yew)).single().seats("Larkspur"))
            assertEquals(true, standingParties(listOf(xan)).single { it.id == other }.seats("Larkspur"))
        }
    }

    @Test
    fun `a request the parties have moved on from is refused whole, writing nothing`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val quill = character(xan, "Quillon")
            val pell = character(yew, "Pellmoor")
            val mine = party(xan, thorn, "Pellmoor")
            val other = party(xan, quill, "Larkspur")
            val theirs = party(yew, pell, "Thornwick", "Larkspur")
            link()
            sendCombine(
                xan,
                friendOf(xan),
                listOf(CombineChoice(mine, theirs, keep = theirs)),
                listOf(SeatChoice("Larkspur", other)),
                Clock.System.now(),
            )
            // Xan's party goes before Yew answers, so the pair the request names is gone.
            Party.update({ Party.id eq mine }) { it[standing] = false }

            assertIs<CombineAnswer.Refused>(acceptCombine(yew, requestFrom(xan)!!.first, Clock.System.now()))
            assertEquals(true, standingParties(listOf(yew)).single().seats("Larkspur"))
            assertEquals(true, Party.selectAll().where { Party.id eq theirs }.single()[Party.standing])
        }
    }

    /** The names a request waiting on [userId] takes out of their parties. */
    private fun incomingTakesOut(userId: String) =
        combinePage(userId, Clock.System.now())
            .incoming
            .single()
            .takesOut
            .map { it.name }

    @Test
    fun `declining clears the request and its notification`() {
        transaction {
            val thorn = character(xan, "Thornwick")
            val pell = character(yew, "Pellmoor")
            party(xan, thorn, "Pellmoor")
            val theirs = party(yew, pell, "Thornwick")
            link()
            sendCombine(xan, friendOf(xan), emptyList(), emptyList(), Clock.System.now())
            val (proposal, _) = requestFrom(xan)!!

            assertEquals(true, dropCombine(yew, proposal))

            assertNull(requestFrom(xan))
            assertEquals(emptyList(), notificationsFor(yew).notifications)
            assertEquals(true, Party.selectAll().where { Party.id eq theirs }.single()[Party.standing])
        }
    }
}
