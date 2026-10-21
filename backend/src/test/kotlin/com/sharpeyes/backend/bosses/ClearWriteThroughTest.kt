package com.sharpeyes.backend.bosses

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.invites.seatInLinkedParties
import com.sharpeyes.backend.parties.PersonRequest
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SavePeopleRequest
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.findParty
import com.sharpeyes.backend.parties.partiesSeatedIn
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.parties.unlinkPerson
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.time.Duration.Companion.hours
import kotlin.time.Instant
import kotlin.uuid.Uuid

/** A party owner's clear, copied onto the linked members who ran with them. */
class ClearWriteThroughTest {
    private val owner = "user_test_through_owner"
    private val member = "user_test_through_member"
    private val everyone = listOf(owner, member)
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
            val characters =
                Characters
                    .selectAll()
                    .where {
                        Characters.userId inList everyone
                    }.map { it[Characters.id] }
            BossClear.deleteWhere { BossClear.characterId inList characters }
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
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[worldType] = WORLD_INTERACTIVE
            it[createdAt] = Clock.System.now()
            it[updatedAt] = Clock.System.now()
            it[position] = 0
        }
        return id
    }

    /** The owner's Kalos with Creed in it, Creed's account linked to the owner's. */
    private fun shared(): Triple<Uuid, Uuid, Uuid> {
        val warrior = character(owner, "warrior2020")
        val creed = character(member, "CreedBratton")
        savePeople(owner, SavePeopleRequest(listOf(PersonRequest(null, "Bro", emptyList()))), Clock.System.now())
        Person.update({ Person.userId eq owner }) { it[linkedUserId] = member }
        val request = SavePartyRequest(warrior.toString(), kalos, listOf("CreedBratton"))
        val party = createParty(owner, warrior, bossIdForKey(kalos)!!, request, Clock.System.now())
        return Triple(warrior, creed, party)
    }

    private fun memberSees(): Boolean? = partiesSeatedIn(member).single().party.cleared

    private fun clearOf(character: Uuid) =
        BossClear
            .selectAll()
            .where { (BossClear.characterId eq character) and (BossClear.bossCatalogId eq bossIdForKey(kalos)!!) }
            .singleOrNull()

    private fun period(now: Instant) =
        periodStartFor(BossCatalog.selectAll().where { BossCatalog.bossKey eq kalos }.single()[BossCatalog.reset], now)

    @Test
    fun `the owner's clear is the member's, and taking it back takes theirs`() {
        transaction {
            val (warrior, creed, party) = shared()
            assertEquals(null, memberSees())

            setBossClearByHand(owner, warrior, kalos, true, Clock.System.now())
            assertEquals(true, memberSees())
            assertEquals(party, clearOf(creed)?.get(BossClear.viaPartyId))

            setBossClearByHand(owner, warrior, kalos, false, Clock.System.now())
            assertNull(clearOf(creed), "a copy goes with the clear behind it, not to a false of its own")
        }
    }

    @Test
    fun `a member's own clear is never overwritten, and an own pending only by a later clear`() {
        transaction {
            val (warrior, creed, _) = shared()
            val now = Clock.System.now()

            fun own(
                cleared: Boolean,
                at: Instant,
            ) = BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) {
                it[characterId] = creed
                it[bossCatalogId] = bossIdForKey(kalos)!!
                it[periodStart] = period(now)
                it[BossClear.cleared] = cleared
                it[capturedAt] = at
                it[sourceScreenshotId] = null
                it[viaPartyId] = null
            }

            // A planner captured before the run said pending. The owner's later clear replaces it.
            own(cleared = false, at = now - 2.hours)
            setBossClearByHand(owner, warrior, kalos, true, now)
            assertEquals(true, memberSees())

            // Creed's own answer recorded after the owner's says pending: that is theirs, and it stands.
            own(cleared = false, at = now + 1.hours)
            assertEquals(false, memberSees())

            // Creed's own clear stays when the owner takes theirs back.
            own(cleared = true, at = now + 3.hours)
            setBossClearByHand(owner, warrior, kalos, false, now + 4.hours)
            assertEquals(true, memberSees())
        }
    }

    @Test
    fun `a member linked after the owner cleared gets it as their seat is bound`() {
        transaction {
            val warrior = character(owner, "warrior2020")
            val creed = character(member, "CreedBratton")
            val request = SavePartyRequest(warrior.toString(), kalos, listOf("CreedBratton"))
            createParty(owner, warrior, bossIdForKey(kalos)!!, request, Clock.System.now())
            setBossClearByHand(owner, warrior, kalos, true, Clock.System.now())
            assertNull(clearOf(creed), "nobody is linked yet")

            savePeople(owner, SavePeopleRequest(listOf(PersonRequest(null, "Bro", emptyList()))), Clock.System.now())
            Person.update({ Person.userId eq owner }) { it[linkedUserId] = member }
            seatInLinkedParties(member, creed, "CreedBratton", WORLD_INTERACTIVE)

            assertEquals(true, memberSees())
        }
    }

    @Test
    fun `the boot pass copies a clear from before the copies existed, once`() {
        transaction {
            val (warrior, creed, _) = shared()
            setBossClearByHand(owner, warrior, kalos, true, Clock.System.now())
            // As every clear recorded before V87 is: no copy behind it.
            BossClear.deleteWhere { BossClear.characterId eq creed }

            copyCurrentClears(Clock.System.now())
            val first = clearOf(creed)?.get(BossClear.capturedAt)
            copyCurrentClears(Clock.System.now())

            assertEquals(true, memberSees())
            assertEquals(first, clearOf(creed)?.get(BossClear.capturedAt), "a second pass writes nothing")
        }
    }

    @Test
    fun `unlinking leaves the member their copy, as a clear of their own`() {
        transaction {
            val (warrior, creed, _) = shared()
            setBossClearByHand(owner, warrior, kalos, true, Clock.System.now())
            val bro = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]

            unlinkPerson(owner, bro)

            // It was their clear in the game. The seats going does not un-clear it. See SharedSlice.kt.
            val kept = clearOf(creed)!!
            assertEquals(true, kept[BossClear.cleared])
            assertNull(kept[BossClear.viaPartyId])
        }
    }

    @Test
    fun `a member left off this week's roster gets nothing`() {
        transaction {
            val (warrior, creed, party) = shared()
            val now = Clock.System.now()
            val ownSeat = findParty(party, owner)!!.seats.first { it.name == "warrior2020" }.id
            // This week spelled out as the owner alone.
            PartyWeekSeat.insert {
                it[partyId] = party
                it[memberId] = Uuid.parse(ownSeat)
                it[weekStart] = period(now)
            }

            setBossClearByHand(owner, warrior, kalos, true, now)

            assertNull(clearOf(creed))
        }
    }

    @Test
    fun `a copy is not copied on`() {
        transaction {
            val (warrior, creed, _) = shared()
            // Creed's account owns a Kalos of its own that seats the owner's warrior.
            savePeople(member, SavePeopleRequest(listOf(PersonRequest(null, "Mech", emptyList()))), Clock.System.now())
            Person.update({ Person.userId eq member }) { it[linkedUserId] = owner }
            val theirs = SavePartyRequest(creed.toString(), kalos, listOf("warrior2020"))
            val theirParty = createParty(member, creed, bossIdForKey(kalos)!!, theirs, Clock.System.now())
            PartyMember.update({
                (PartyMember.partyId eq theirParty) and (PartyMember.name eq "warrior2020") and
                    PartyMember.characterId.isNull()
            }) { it[linkedCharacterId] = warrior }

            setBossClearByHand(owner, warrior, kalos, true, Clock.System.now())

            // The owner's warrior keeps its own row, and Creed's copy did not flow back over it.
            assertEquals(null, clearOf(warrior)?.get(BossClear.viaPartyId))
            assertEquals(true, clearOf(creed)?.get(BossClear.cleared))
        }
    }
}
