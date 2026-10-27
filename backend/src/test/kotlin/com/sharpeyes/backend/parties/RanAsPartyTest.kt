package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.uuid.Uuid

/**
 * The Boss Matrix's party flag, week by week, as a config is added, taken off, converted and
 * deleted. Each case drives the same writes the routes make and reads the flag back for every week
 * it touches, because a flag that is right this week and wrong for the weeks before is a plausible
 * wrong answer about who you ran with.
 */
class RanAsPartyTest {
    private val userId = "user_test_ran_as_party"
    private val boss = "kalos-the-guardian"

    private val now = Clock.System.now()
    private val thisWeek = currentWeek()
    private val lastWeek = thisWeek.minus(DatePeriod(days = 7))
    private val twoWeeksAgo = thisWeek.minus(DatePeriod(days = 14))

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
        // A local, never the property: inside deleteWhere {} a bare `userId` is the table's own column,
        // and `user_id = user_id` deleted every character and party in the database this ran against.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private fun character(): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        // Aliased: inside insert {} the table's own userId column beats this class's property.
        val owner = userId
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[name] = "Rune"
            it[worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun request(
        me: Uuid,
        members: List<String> = listOf("Steve"),
        oneOff: Boolean = false,
    ) = SavePartyRequest(me.toString(), boss, members, oneOff = oneOff)

    private fun create(
        me: Uuid,
        at: kotlin.time.Instant,
        oneOff: Boolean = false,
    ): Uuid = createParty(userId, me, bossIdForKey(boss)!!, request(me, oneOff = oneOff), at)

    /** The flag for [week], or null when the config is not on the list at all. */
    private fun flag(
        partyId: Uuid,
        week: LocalDate,
    ): Boolean? =
        partiesFor(userId, week, includeSolo = true)
            .singleOrNull { it.id == partyId.toString() }
            ?.ranAsParty

    @Test
    fun `a standing party flags the weeks since it was made and not the ones before`() {
        transaction {
            val party = create(character(), now - 7.days)
            assertEquals(true, flag(party, thisWeek))
            assertEquals(true, flag(party, lastWeek))
            assertEquals(false, flag(party, twoWeeksAgo))
        }
    }

    @Test
    fun `a week taken off is not flagged, and putting it back is`() {
        transaction {
            val party = create(character(), now - 7.days)
            setRunsInPeriod(party, oneOff = false, thisWeek, runs = false, now = now)
            assertEquals(false, flag(party, thisWeek))
            assertEquals(true, flag(party, lastWeek))

            setRunsInPeriod(party, oneOff = false, thisWeek, runs = true, now = now)
            assertEquals(true, flag(party, thisWeek))
        }
    }

    @Test
    fun `a temp party flags the week it ran and no other`() {
        transaction {
            val party = create(character(), now - 7.days, oneOff = true)
            assertEquals(true, flag(party, lastWeek))
            assertEquals(false, flag(party, thisWeek))
            assertEquals(false, flag(party, twoWeeksAgo))
        }
    }

    @Test
    fun `a temp party removed from this week is no longer flagged`() {
        transaction {
            val party = create(character(), now, oneOff = true)
            assertEquals(true, flag(party, thisWeek))
            setRunsInPeriod(party, oneOff = true, thisWeek, runs = false, now = now)
            assertEquals(false, flag(party, thisWeek))
        }
    }

    @Test
    fun `a temp party made standing keeps its night and does not claim the weeks between`() {
        transaction {
            val me = character()
            val party = create(me, now - 14.days, oneOff = true)
            takeOverParty(userId, party, request(me), now)

            assertEquals(true, flag(party, twoWeeksAgo), "the night it ran as a temp party")
            assertEquals(false, flag(party, lastWeek), "a week it did not run")
            assertEquals(true, flag(party, thisWeek))
        }
    }

    @Test
    fun `a solo pool adopted as a party does not flag the weeks it was solo`() {
        transaction {
            val me = character()
            val party = createSoloParty(userId, me, bossIdForKey(boss)!!, now - 14.days)
            assertEquals(false, flag(party, lastWeek))

            adoptSoloParty(userId, party, request(me), now)
            assertEquals(false, flag(party, lastWeek))
            assertEquals(false, flag(party, twoWeeksAgo))
            assertEquals(true, flag(party, thisWeek))
        }
    }

    @Test
    fun `a party saved with nobody else in it stops being flagged`() {
        transaction {
            val me = character()
            val party = create(me, now - 7.days)
            saveParty(userId, party, request(me, members = emptyList()), now)
            assertEquals(false, flag(party, thisWeek))
        }
    }

    @Test
    fun `a week run with nobody else is not flagged`() {
        transaction {
            val me = character()
            val party = create(me, now - 7.days)
            saveWeekRoster(party, me, thisWeek, emptyList(), SeatContext(userId, emptyMap(), now))
            assertEquals(false, flag(party, thisWeek))
            assertEquals(true, flag(party, lastWeek))
        }
    }

    @Test
    fun `a deleted party is gone from every week`() {
        transaction {
            val party = create(character(), now - 7.days)
            assertEquals(Removal.DELETED, retireOrDeleteParty(party, userId, now))
            assertNull(flag(party, thisWeek))
            assertNull(flag(party, lastWeek))
        }
    }

    @Test
    fun `a retired party revived does not claim the weeks it was retired`() {
        transaction {
            val me = character()
            val party = create(me, now - 14.days)
            // What retireOrDeleteParty writes for a config that holds a pool.
            Party.update({ Party.id eq party }) { it[standing] = false }
            assertNull(flag(party, thisWeek), "off the list, like a deleted one")

            takeOverParty(userId, party, request(me), now)
            assertEquals(true, flag(party, thisWeek))
            assertEquals(false, flag(party, lastWeek))
        }
    }
}
