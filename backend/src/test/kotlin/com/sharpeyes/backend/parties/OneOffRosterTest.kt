package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.system.Refusal
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A one night party, against a real Postgres.
 *
 * The claim worth a database is that a one-off's people are in the night and in no week after it.
 * Written as standing seats they were the fallback for every week nobody answered for, so a boss run
 * alone a fortnight later split with a guest who was not there and paid them. That is the failure
 * this repo exists to prevent, reached through Add Drop.
 */
class OneOffRosterTest {
    private val userId = "user_test_one_off_roster"

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

    private fun thisWeek() = weekOf(todayUtc())

    private fun nextWeek() = thisWeek().plus(7, DateTimeUnit.DAY)

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
        // Held in a local: inside deleteWhere {} the TABLE is the receiver, so a bare `userId`
        // binds to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private fun mine(named: String): Uuid {
        ensureUser(userId, "$userId@example.com")
        // A character is inserted here directly, so the account has to say which world it is
        // looking at or every account-wide read below is empty. The route refuses to create a
        // character without one at all: see V74 and users/WorldType.kt.
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = named
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun nightOn(
        characterId: Uuid,
        bossKey: String = "limbo",
        members: List<String> = listOf("Steve"),
        oneOff: Boolean = true,
    ): PartyResponse {
        val request = SavePartyRequest(characterId.toString(), bossKey, members, oneOff = oneOff)
        val id = createParty(userId, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now())
        return findParty(id, userId)!!
    }

    private fun namesIn(
        party: PartyResponse,
        week: LocalDate,
    ): List<String> = rosterNamesFor(Uuid.parse(party.id), week)

    @Test
    fun `the night names the people it was made with`() {
        transaction {
            val party = nightOn(mine("Rune"))
            assertEquals(listOf("Rune", "Steve"), namesIn(party, thisWeek()))
            assertEquals(listOf("Rune", "Steve"), party.members.map { it.name })
        }
    }

    @Test
    fun `a week after the night is you alone`() {
        transaction {
            val party = nightOn(mine("Rune"))
            // The bug, in one line: Steve was a standing seat, so every later week fell back to him
            // and a solo kill divided in two.
            assertEquals(listOf("Rune"), namesIn(party, nextWeek()))
        }
    }

    @Test
    fun `a standing party still runs its usual roster every week`() {
        transaction {
            val party = nightOn(mine("Rune"), oneOff = false)
            assertEquals(listOf("Rune", "Steve"), namesIn(party, thisWeek()))
            assertEquals(listOf("Rune", "Steve"), namesIn(party, nextWeek()))
        }
    }

    @Test
    fun `a drop already in the week is not held out of the night it fell on`() {
        transaction {
            val own = mine("Rune")
            val boss = bossIdForKey("limbo")!!
            // A solo pool with a drop in it, which is what logging one on a boss with no party
            // opens. Naming the night afterwards used to leave the week pinned to the roster of one
            // that was there before, so the people it was made with showed up in no week at all.
            val pool = poolFor(userId, own, boss, Clock.System.now())
            addLoot(pool, LootedDrop(dropIdForKey("grindstone-of-faith")!!), boss, todayUtc(), Clock.System.now())

            val request = SavePartyRequest(own.toString(), "limbo", listOf("Steve"), oneOff = true)
            takeOverParty(userId, pool, request, Clock.System.now())

            assertEquals(listOf("Rune", "Steve"), rosterNamesFor(pool, thisWeek()))
            assertEquals(listOf("Rune"), rosterNamesFor(pool, nextWeek()))
        }
    }

    @Test
    fun `one guest cannot run the same boss on two nights in one week`() {
        transaction {
            nightOn(mine("Rune"))
            // Steve's clear is spent on the first night, and the seat holding it is no longer a
            // standing one, so only the WEEK can still say so. See validateNight.
            val second =
                SavePartyRequest(mine("Kade").toString(), "limbo", listOf("Steve"), oneOff = true)
            val refusal =
                validateNewParty(
                    second,
                    userId,
                    Uuid.parse(second.characterId),
                    bossIdForKey("limbo"),
                    Clock.System.now(),
                )
            assertTrue(refusal is Refusal && refusal.refusal.contains("Steve"), refusal.toString())
        }
    }

    @Test
    fun `taking the last member out hides the party and keeps its drops`() {
        transaction {
            val own = mine("Rune")
            val boss = bossIdForKey("limbo")!!
            val party = nightOn(own, oneOff = false)
            val partyId = Uuid.parse(party.id)
            val grindstone = LootedDrop(dropIdForKey("grindstone-of-faith")!!)
            addLoot(partyId, grindstone, boss, todayUtc(), Clock.System.now())

            // Steve stops running it. Refusing this would leave deleting the config as the only way
            // to say so, and deleting takes the pool with it.
            saveParty(
                userId,
                partyId,
                SavePartyRequest(own.toString(), "limbo", emptyList()),
                Clock.System.now(),
            )

            val after = findParty(partyId, userId)!!
            assertTrue(after.solo)
            // A week that already holds a drop is a night played, and it keeps the seats it was
            // played with: taking Steve out today does not un-owe him half of what fell while he
            // was in it. Every week after is the roster of one this now is.
            assertEquals(listOf("Rune", "Steve"), namesIn(after, thisWeek()))
            assertEquals(listOf("Rune"), namesIn(after, nextWeek()))
            // Off Party View, on the list the Drop Log reads, drop and all.
            assertTrue(partiesFor(userId).none { it.id == party.id })
            assertTrue(partiesFor(userId, includeSolo = true).any { it.id == party.id })
            assertEquals(1, lootFor(partyId).size)
        }
    }

    @Test
    fun `a party cannot be MADE with nobody else in it`() {
        transaction {
            // The other half of the same rule: an edit has a config to demote, and a create does
            // not, so this would be a party of one on the page that lists parties.
            assertEquals(Refusal("This party has nobody else in it. Add a member."), validateMembers(emptyList()))
            assertNull(validateMembers(emptyList(), allowNone = true))
        }
    }

    @Test
    fun `a night cannot be put back to a usual party it does not have`() {
        transaction {
            val party = nightOn(mine("Rune"))
            // Clearing the week is what "Use the usual party" sends. A one-off has none, so this
            // would leave the config naming nobody. See validateRosterClear.
            assertNotNull(validateRosterClear(Uuid.parse(party.id), null))
            // Saying who ran it is still the same route's job.
            assertNull(validateRosterClear(Uuid.parse(party.id), listOf("Steve")))
        }
    }
}
