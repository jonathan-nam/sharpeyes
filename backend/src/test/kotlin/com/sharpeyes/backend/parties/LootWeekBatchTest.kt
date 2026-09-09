package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * weekRostersFor answers exactly what asking week by week answered.
 *
 * This decides who a drop divides by, so equivalence is the whole requirement and speed is
 * incidental. The reference is rostersFor and weekSharesFor THEMSELVES rather than a copy of their
 * logic, so the two cannot drift apart and still pass.
 *
 * The cases that matter are the ones where "no rows" and "rows with nothing in them" mean different
 * things. A week with no party_week_seat rows ran the standing roster. A week WITH rows ran exactly
 * those seats, and rows whose shares are null still mean the week was spelled out, which is the
 * fingerprint of a wrong week roster in #509. Getting that backwards divides a drop by the wrong
 * people, which is money.
 */
class LootWeekBatchTest {
    private val userId = "user_test_week_batch"

    private val weekA = LocalDate(2026, 7, 27)
    private val weekB = LocalDate(2026, 8, 3)
    private val weekC = LocalDate(2026, 8, 10)
    private val weekNobodyTouched = LocalDate(2026, 8, 17)

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
            val parties = Party.selectAll().where { Party.userId eq userId }.map { it[Party.id] }
            parties.forEach { id -> PartyWeekSeat.deleteWhere { partyId eq id } }
            parties.forEach { id -> PartyMember.deleteWhere { partyId eq id } }
            Party.deleteWhere { Party.userId eq userId }
            Characters.deleteWhere { Characters.userId eq userId }
        }
    }

    private fun party(position: Int): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val characterId = Uuid.random()
        val now = Clock.System.now()
        // Aliased outside the insert blocks: inside them the TABLE is the receiver, so a bare
        // `userId` or `position` resolves to its column rather than to these, and Postgres refuses
        // the statement with "invalid reference to FROM-clause entry".
        val uid = userId
        val slot = position
        Characters.insert {
            it[Characters.id] = characterId
            it[Characters.userId] = uid
            it[name] = "Batch$slot"
            it[createdAt] = now
            it[updatedAt] = now
            it[Characters.position] = slot
        }
        val partyId = Uuid.random()
        Party.insert {
            it[Party.id] = partyId
            it[Party.userId] = uid
            it[Party.characterId] = characterId
            it[bossCatalogId] =
                BossCatalog
                    .selectAll()
                    .orderBy(BossCatalog.sortOrder)
                    .drop(slot)
                    .first()[BossCatalog.id]
            it[solo] = false
            it[oneOff] = false
            it[standing] = true
            it[createdAt] = now
            it[updatedAt] = now
        }
        return partyId
    }

    private fun seat(
        partyId: Uuid,
        name: String,
        position: Int,
        standing: Boolean = true,
    ): Uuid {
        val id = Uuid.random()
        val seatName = name
        val slot = position
        val isStanding = standing
        PartyMember.insert {
            it[PartyMember.id] = id
            it[PartyMember.partyId] = partyId
            it[PartyMember.name] = seatName
            it[PartyMember.position] = slot
            it[PartyMember.standing] = isStanding
            it[PartyMember.shares] = 1
        }
        return id
    }

    private fun weekSeat(
        partyId: Uuid,
        week: LocalDate,
        memberId: Uuid,
        shares: Int?,
    ) {
        val howMany = shares
        PartyWeekSeat.insert {
            it[PartyWeekSeat.partyId] = partyId
            it[weekStart] = week
            it[PartyWeekSeat.memberId] = memberId
            it[PartyWeekSeat.shares] = howMany
        }
    }

    /** Every (party, week) pair, batched, must equal the same pair asked for on its own. */
    private fun assertMatchesPerWeek(
        partyIds: List<Uuid>,
        weeks: Set<LocalDate>,
    ) {
        val batched = weekRostersFor(partyIds, weeks)
        for (partyId in partyIds) {
            for (week in weeks) {
                assertEquals(
                    rostersFor(listOf(partyId), week)[partyId].orEmpty(),
                    batched.roster(partyId, week),
                    "roster for $partyId in $week",
                )
                assertEquals(
                    weekSharesFor(listOf(partyId), week)[partyId],
                    batched.shares(partyId, week),
                    "shares for $partyId in $week",
                )
            }
        }
    }

    @Test
    fun `a week nobody spelled out runs the standing roster`() {
        transaction {
            val p = party(0)
            seat(p, "Standing", 0)
            seat(p, "AlsoStanding", 1)
            // A guest seat, which the standing roster must leave out.
            seat(p, "Guest", 2, standing = false)

            assertMatchesPerWeek(listOf(p), setOf(weekNobodyTouched))
            assertEquals(2, weekRostersFor(listOf(p), setOf(weekNobodyTouched)).roster(p, weekNobodyTouched).size)
        }
    }

    // The case #509 is about: rows exist, shares are null. The week WAS spelled out, so the roster
    // is those seats and not the standing ones, and there are no shares to report.
    @Test
    fun `rows with null shares still spell the week out`() {
        transaction {
            val p = party(0)
            val standing = seat(p, "Standing", 0)
            seat(p, "LeftOutThisWeek", 1)
            weekSeat(p, weekA, standing, shares = null)

            assertMatchesPerWeek(listOf(p), setOf(weekA))

            val batched = weekRostersFor(listOf(p), setOf(weekA))
            assertEquals(listOf(standing), batched.roster(p, weekA), "only the seat the week named")
            assertEquals(null, batched.shares(p, weekA), "null shares report nothing, not an empty deal")
        }
    }

    @Test
    fun `a week with shares reports them`() {
        transaction {
            val p = party(0)
            val a = seat(p, "A", 0)
            val b = seat(p, "B", 1)
            weekSeat(p, weekA, a, shares = 2)
            weekSeat(p, weekA, b, shares = 1)

            assertMatchesPerWeek(listOf(p), setOf(weekA))
            assertEquals(mapOf(a to 2, b to 1), weekRostersFor(listOf(p), setOf(weekA)).shares(p, weekA))
        }
    }

    // The reason batching is worth doing at all, and the reason it could go wrong: several weeks
    // with different rosters, asked for together. A key collision here would divide August's drop
    // by July's party.
    @Test
    fun `different weeks keep different rosters`() {
        transaction {
            val p = party(0)
            val a = seat(p, "A", 0)
            val b = seat(p, "B", 1)
            val c = seat(p, "C", 2)
            weekSeat(p, weekA, a, shares = 1)
            weekSeat(p, weekB, b, shares = 3)
            weekSeat(p, weekC, a, shares = 1)
            weekSeat(p, weekC, c, shares = 1)

            assertMatchesPerWeek(listOf(p), setOf(weekA, weekB, weekC, weekNobodyTouched))

            val batched = weekRostersFor(listOf(p), setOf(weekA, weekB, weekC, weekNobodyTouched))
            assertEquals(listOf(a), batched.roster(p, weekA))
            assertEquals(listOf(b), batched.roster(p, weekB))
            assertEquals(listOf(a, c), batched.roster(p, weekC), "in seat order, not row order")
            assertEquals(listOf(a, b, c), batched.roster(p, weekNobodyTouched), "standing")
        }
    }

    @Test
    fun `two parties in the same weeks do not borrow each other's rosters`() {
        transaction {
            val one = party(0)
            val two = party(1)
            val oneA = seat(one, "OneA", 0)
            seat(one, "OneB", 1)
            val twoA = seat(two, "TwoA", 0)
            val twoB = seat(two, "TwoB", 1)
            weekSeat(one, weekA, oneA, shares = 5)
            weekSeat(two, weekA, twoB, shares = 7)

            assertMatchesPerWeek(listOf(one, two), setOf(weekA, weekB))

            val batched = weekRostersFor(listOf(one, two), setOf(weekA, weekB))
            assertEquals(listOf(oneA), batched.roster(one, weekA))
            assertEquals(listOf(twoB), batched.roster(two, weekA))
            assertEquals(mapOf(oneA to 5), batched.shares(one, weekA))
            assertEquals(mapOf(twoB to 7), batched.shares(two, weekA))
            assertEquals(listOf(twoA, twoB), batched.roster(two, weekB), "untouched week is standing")
        }
    }

    @Test
    fun `asking for nothing answers nothing`() {
        transaction {
            val p = party(0)
            seat(p, "A", 0)

            assertEquals(emptyList(), weekRostersFor(emptyList(), setOf(weekA)).roster(p, weekA))
            assertEquals(emptyList(), weekRostersFor(listOf(p), emptySet()).roster(p, weekA))
            assertEquals(null, weekRostersFor(emptyList(), emptySet()).shares(p, weekA))
        }
    }
}
