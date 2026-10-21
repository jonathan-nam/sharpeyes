package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A week that was not the usual party, against a real Postgres.
 *
 * The claim worth a database is that "who is in this party" and "who ran it that week" are allowed
 * to differ WITHOUT either one quietly becoming the other. Two ways that goes wrong and both are a
 * confidently wrong number: a guest week that pays the member who sat it out, and a roster change
 * made today that rewrites a week already played.
 */
class PartyWeekRosterTest {
    private val userId = "user_test_week_roster"

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

    /** The week the app is in, which is the only one a roster may be written for. */
    private fun thisWeek() = weekOf(todayUtc())

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

    /** Your character plus Steve and Bob, which is the usual party in every test here. */
    private fun trio(
        difficulty: String? = null,
        bossKey: String = "limbo",
    ): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        // A character is inserted here directly, so the account has to say which world it is
        // looking at or every account-wide read below is empty. The route refuses to create a
        // character without one at all: see V74 and users/WorldType.kt.
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(mine.toString(), bossKey, listOf("Steve", "Bob"), difficulty = difficulty)
        val id = createParty(userId, mine, bossIdForKey(bossKey)!!, request, now)
        return findParty(id, userId)!!
    }

    private fun context() = SeatContext(userId, emptyMap(), Clock.System.now())

    /** Cara in for Bob, this week only. */
    private fun caraForBob(
        party: PartyResponse,
        week: LocalDate = thisWeek(),
    ) = saveWeekRoster(
        Uuid.parse(party.id),
        Uuid.parse(party.characterId),
        week,
        listOf("Steve", "Cara"),
        context(),
    )

    private fun addGrindstoneOn(
        party: PartyResponse,
        on: LocalDate,
        bossKey: String = "limbo",
    ): Uuid =
        addLoot(
            Uuid.parse(party.id),
            LootedDrop(dropIdForKey("grindstone-of-faith")!!),
            bossIdForKey(bossKey),
            on,
            Clock.System.now(),
        )

    @Test
    fun `a week nobody has said anything about runs the usual party`() {
        transaction {
            val party = trio()
            // The default, and the reason a week with no rows is the answer rather than a gap:
            // most weeks are simply the party, and they should cost nothing to record.
            assertEquals(listOf("Rune", "Steve", "Bob"), party.members.map { it.name })
            assertTrue(party.usualRoster)
            assertTrue(party.members.none { it.guest })
        }
    }

    @Test
    fun `a guest week says who ran, and leaves the party itself alone`() {
        transaction {
            val party = trio()
            caraForBob(party)

            val thisWeek = findParty(Uuid.parse(party.id), userId)!!
            assertEquals(listOf("Rune", "Steve", "Cara"), thisWeek.members.map { it.name })
            assertFalse(thisWeek.usualRoster)
            // Marked, because otherwise the only thing on screen saying this is not the usual
            // party would be remembering that it is not.
            assertTrue(thisWeek.members.single { it.name == "Cara" }.guest)

            // Next week has no rows of its own, so it is the party again. Reverting is the
            // default rather than something to remember to do.
            val partyId = Uuid.parse(party.id)
            val nextWeek = rosterFor(partyId, thisWeek().plus(DAYS_IN_WEEK, DateTimeUnit.DAY))
            assertEquals(3, nextWeek.size)
        }
    }

    @Test
    fun `a drop from a guest week owes the guest and not the member who sat out`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)

            // The money claim. Bob was not there, so he is owed nothing; Cara was, so she is.
            val lootId = addGrindstoneOn(party, todayUtc())
            val seats = findParty(partyId, userId)!!.members
            val seller = seats.first { it.name == "Rune" }
            sellLoot(
                lootId,
                SellLootRequest(9_000_000_000, "LISTED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )

            val owed = findLoot(lootId, partyId)!!.payouts.map { it.memberId }.toSet()
            val bob = party.members.first { it.name == "Bob" }
            val cara = seats.first { it.name == "Cara" }
            assertEquals(setOf(seats.first { it.name == "Steve" }.id, cara.id), owed)
            assertFalse(bob.id in owed)
        }
    }

    @Test
    fun `putting the week back to the usual party is a deletion, not a copy of it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)

            saveWeekRoster(partyId, Uuid.parse(party.characterId), thisWeek(), null, context())

            val back = findParty(partyId, userId)!!
            assertEquals(listOf("Rune", "Steve", "Bob"), back.members.map { it.name })
            assertTrue(back.usualRoster)
            // A copy would have frozen the week against the party: this proves it followed.
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob", "Ines")),
                Clock.System.now(),
            )
            assertTrue(findParty(partyId, userId)!!.members.any { it.name == "Ines" })
        }
    }

    @Test
    fun `a week already played keeps its roster when the party changes afterwards`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)

            // Bob leaves the party for good, and Ines joins. The week Cara guested in is not
            // about either of them, and must not be rewritten by a decision taken after it.
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Ines")),
                Clock.System.now(),
            )

            val week = findParty(partyId, userId)!!
            assertEquals(listOf("Rune", "Steve", "Cara"), week.members.map { it.name })
            // Cara's seat survived a save that named neither her nor Bob.
            assertEquals(1, seatsNamed(partyId, "Cara"))
        }
    }

    @Test
    fun `a guest who joins the party for good keeps the seat they guested in`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)
            val guested = findParty(partyId, userId)!!.members.first { it.name == "Cara" }

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob", "Cara")),
                Clock.System.now(),
            )

            // One Cara, not two. A second seat would leave anything she was owed pointing at a
            // Cara who is no longer in the party.
            assertEquals(1, seatsNamed(partyId, "Cara"))
            // This week is still spelled out (Bob is still out of it), but she is not a guest in
            // the party any more.
            val now = findParty(partyId, userId)!!
            assertEquals(guested.id, now.members.first { it.name == "Cara" }.id)
            assertFalse(now.members.first { it.name == "Cara" }.guest)
        }
    }

    @Test
    fun `a drop carries the roster of its own week, not of the party today`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstoneOn(party, todayUtc())
            caraForBob(party)
            val cara = findParty(partyId, userId)!!.members.first { it.name == "Cara" }
            val bob = party.members.first { it.name == "Bob" }

            // What the seller select offers, so it offers exactly what the sell route accepts.
            // Bob did not run: naming him would make every share on this drop wrong.
            val ran = findLoot(lootId, partyId)!!.ranThatWeek
            assertTrue(cara.id in ran, "the guest who ran can be named as seller")
            assertFalse(bob.id in ran, "the member who sat out cannot")
        }
    }

    /** A boss this character has never had a party for, with a drop already in its pool. */
    private fun soloWithADrop(): Triple<Uuid, Uuid, Uuid> {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val partyId = createSoloParty(userId, mine, bossIdForKey("limbo")!!, now)
        val lootId =
            addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossIdForKey("limbo"), todayUtc(), now)
        return Triple(partyId, mine, lootId)
    }

    @Test
    fun `a night with whoever was around gives the config no standing roster`() {
        transaction {
            val (partyId, characterId, lootId) = soloWithADrop()
            // The pug case: no set party, and this Thursday it was Steve and Bob. Said as a WEEK.
            openSoloParty(partyId, thisWeek(), Clock.System.now())
            saveWeekRoster(partyId, characterId, thisWeek(), listOf("Steve", "Bob"), context())

            val party = findParty(partyId, userId)!!
            assertEquals(listOf("Rune", "Steve", "Bob"), party.members.map { it.name })
            // Both are guests, so they are seats a payout can point at and nothing more. Written as
            // the standing roster instead, they would be who every later week ran by default.
            assertTrue(party.members.filter { it.name != "Rune" }.all { it.guest })
            // What the ledger divides against, which is the whole point of answering the night: the
            // drop that was sitting in a pool of one is now a drop three people are owed out of.
            assertEquals(3, findLoot(lootId, partyId)!!.ranThatWeek.size)
        }
    }

    @Test
    fun `a later week nobody has answered for claims nobody, rather than last week's strangers`() {
        transaction {
            val (partyId, characterId, _) = soloWithADrop()
            openSoloParty(partyId, thisWeek(), Clock.System.now())
            saveWeekRoster(partyId, characterId, thisWeek(), listOf("Steve", "Bob"), context())

            // Next Thursday, before anybody says anything about it. A standing roster here would
            // divide 180 coupons three ways and owe a share to two people who were not in the game,
            // which is a debt invented out of a default.
            val next = thisWeek().plus(7, DateTimeUnit.DAY)
            assertEquals(1, rosterFor(partyId, next).size, "your own character and nobody else")
        }
    }

    @Test
    fun `a past week is still answerable while everything it dropped is in the pool`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            // The case that made the old this-week-only rule bite: a Wednesday night run, come back
            // to on Thursday morning. The reset had put it out of reach an hour after it happened.
            val lastWeek = thisWeek().plus(-7, DateTimeUnit.DAY)
            addGrindstoneOn(party, lastWeek)

            assertFalse(payoutsPinnedIn(partyId, lastWeek), "nothing sold, so nothing to contradict")
        }
    }

    @Test
    fun `a week closes to edits once a drop in it has been sold`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lastWeek = thisWeek().plus(-7, DateTimeUnit.DAY)
            val lootId = addGrindstoneOn(party, lastWeek)
            val seller = rosterFor(partyId, lastWeek).first()
            sellLoot(
                lootId,
                SellLootRequest(1_000_000, "LISTED", "FAIR", seller.toString()),
                seller,
                partyId,
                Clock.System.now(),
            )

            // The payout was pinned from the roster as it stood. Rewriting who ran now would owe a
            // share to somebody the rows do not name, and the two would disagree with nothing on
            // screen saying which is right.
            assertTrue(payoutsPinnedIn(partyId, lastWeek))
            // Per week, not per party: the week beside it never sold anything and is still open.
            assertFalse(payoutsPinnedIn(partyId, thisWeek()))
        }
    }

    @Test
    fun `a drop names the week it fell in, cut on Thursday`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            // The Drop Log heads its sections with this. July 16 2026 is a Thursday, so the drop
            // the day before belongs to the week before: off by one and a drop is filed under the
            // neighbouring week, which reads as a quiet week sitting beside a doubled one.
            val eve = addGrindstoneOn(party, LocalDate.parse("2026-07-15"))
            val resetDay = addGrindstoneOn(party, LocalDate.parse("2026-07-16"))
            val midweek = addGrindstoneOn(party, LocalDate.parse("2026-07-20"))

            assertEquals("2026-07-09", findLoot(eve, partyId)!!.weekStart)
            assertEquals("2026-07-16", findLoot(resetDay, partyId)!!.weekStart)
            assertEquals("2026-07-16", findLoot(midweek, partyId)!!.weekStart)
        }
    }

    @Test
    fun `a guest stays readable as a seat after their week has passed`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)
            val cara = findParty(partyId, userId)!!.members.first { it.name == "Cara" }

            // Cara is owed for the drop she was there for, and the wallet reads a payout against
            // `seats`. If she were only in `members`, the week rolling over would take her out of
            // it and the split would go unreadable with the debt still real.
            val next = partiesFor(userId, thisWeek().plus(DAYS_IN_WEEK, DateTimeUnit.DAY))
            val row = next.first { it.id == party.id }
            assertTrue(row.members.none { it.name == "Cara" }, "not in next week's roster")
            assertTrue(row.seats.any { it.id == cara.id }, "still a seat the pool can name")
            assertTrue(row.usualRoster)
        }
    }

    @Test
    fun `your own character is in the week whether or not you name them`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            // The config IS that character, so a week cannot be run without them. Same rule the
            // usual roster keeps, and it has to be the same rule: they are the seat that sells
            // most drops, and an unnameable seller cannot pay anybody.
            caraForBob(party)
            assertEquals("Rune", findParty(partyId, userId)!!.members.first().name)
        }
    }

    /** Bob out, Ines in, as the party ITSELF. The edit every test below is about. */
    private fun inesForBob(party: PartyResponse) =
        saveParty(
            userId,
            Uuid.parse(party.id),
            SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Ines")),
            Clock.System.now(),
        )

    private fun nextWeek(party: PartyResponse) =
        partiesFor(userId, thisWeek().plus(DAYS_IN_WEEK, DateTimeUnit.DAY)).first { it.id == party.id }

    @Test
    fun `a week nobody has written into is the party as it is edited to`() {
        transaction {
            val party = trio()
            // Nothing has dropped and nobody has ticked the boss, so the config is still a template
            // for this week: swapping a member before the run is the party that runs it.
            inesForBob(party)

            val shown = findParty(Uuid.parse(party.id), userId)!!
            assertEquals(listOf("Rune", "Steve", "Ines"), shown.members.map { it.name })
            assertTrue(shown.usualRoster, "nothing to spell out")
        }
    }

    @Test
    fun `a week that dropped something keeps the party that dropped it, and the edit lands next week`() {
        transaction {
            val party = trio()
            addGrindstoneOn(party, todayUtc())

            inesForBob(party)

            // Bob ran this week and the grindstone is still in the pool. Putting Ines in his place
            // now would owe her a share of a night she was not in.
            val shown = findParty(Uuid.parse(party.id), userId)!!
            assertEquals(listOf("Rune", "Steve", "Bob"), shown.members.map { it.name })
            assertFalse(shown.usualRoster)
            assertEquals(listOf("Rune", "Steve", "Ines"), nextWeek(party).members.map { it.name })
        }
    }

    @Test
    fun `a week the boss was cleared in keeps the party that cleared it`() {
        transaction {
            val party = trio()
            val boss = bossIdForKey("limbo")!!
            // A clear says the party ran just as a drop does, and a night that dropped nothing is
            // still a night three people turned up for.
            setPartyClear(party, boss, bossResetOf(boss)!!, cleared = true, now = Clock.System.now())

            inesForBob(party)

            assertEquals(
                listOf("Rune", "Steve", "Bob"),
                findParty(Uuid.parse(party.id), userId)!!.members.map { it.name },
            )
            assertEquals(listOf("Rune", "Steve", "Ines"), nextWeek(party).members.map { it.name })
        }
    }

    @Test
    fun `a new deal divides the week it was agreed in by itself`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstoneOn(party, todayUtc())

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), shares = mapOf("Steve" to 3)),
                Clock.System.now(),
            )

            // The night is over, the week is not. A drop is what makes people sit down and agree a
            // split, so pinning the old one here left the config saying 3 and the drop under it
            // still dividing evenly, with no way to reach the frozen figure and no week's roster to
            // correct it through.
            val steve = findParty(partyId, userId)!!.members.first { it.name == "Steve" }
            assertEquals(3, steve.shares)
            assertNull(findLoot(lootId, partyId)!!.sharesThatWeek[steve.id], "the standing deal")
        }
    }

    @Test
    fun `a live week pinned by an older edit is put back on the standing deal`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstoneOn(party, todayUtc())
            val steve = party.members.first { it.name == "Steve" }

            // This week, pinned at the even split, which is what every edit did before a live week
            // was allowed to move. Written straight in because nothing writes one any more.
            party.members.forEach { seat ->
                PartyWeekSeat.insert {
                    it[PartyWeekSeat.partyId] = partyId
                    it[weekStart] = thisWeek()
                    it[memberId] = Uuid.parse(seat.id)
                    it[shares] = 1
                }
            }

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), shares = mapOf("Steve" to 3)),
                Clock.System.now(),
            )

            // The pin is the week's answer and beats the standing weight on read, so leaving it
            // there left the config saying 3 and this week's drop still dividing evenly, with every
            // further edit doing nothing at all. That is what the fix looked like from the outside:
            // still broken.
            assertNull(findLoot(lootId, partyId)!!.sharesThatWeek[steve.id], "back on the standing deal")
        }
    }

    @Test
    fun `a week that is over keeps the deal it was run under`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstoneOn(party, todayUtc().plus(-DAYS_IN_WEEK, DateTimeUnit.DAY))

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), shares = mapOf("Steve" to 3)),
                Clock.System.now(),
            )

            // The whole of V55. Last week's coupons are outstanding and everybody has been shown a
            // figure for them, so a deal agreed today must not hand Steve three quarters of them.
            val steve = findParty(partyId, userId)!!.members.first { it.name == "Steve" }
            assertEquals(3, steve.shares)
            assertEquals(1, findLoot(lootId, partyId)!!.sharesThatWeek[steve.id])
        }
    }

    @Test
    fun `a month that has closed keeps its deal, even in the week it opened the next one in`() {
        transaction {
            val party = trio(bossKey = "black-mage")
            val partyId = Uuid.parse(party.id)
            // Black Mage is MONTHLY. August 2026 opens on a Saturday, so the month starts inside the
            // week of Thursday 2026-07-30, and that week holds July's last two days. Measuring the
            // live period by the WEEK its period starts in would call that week live and hand July's
            // outstanding coupons to a deal agreed in August.
            val lootId = addGrindstoneOn(party, LocalDate.parse("2026-07-31"), bossKey = "black-mage")

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "black-mage", listOf("Steve", "Bob"), shares = mapOf("Steve" to 3)),
                LocalDate.parse("2026-08-02").atStartOfDayIn(TimeZone.UTC),
            )

            val steve = findParty(partyId, userId)!!.members.first { it.name == "Steve" }
            assertEquals(1, findLoot(lootId, partyId)!!.sharesThatWeek[steve.id])
        }
    }

    @Test
    fun `a week with a sale behind it keeps the split that sale was paid on`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstoneOn(party, todayUtc())
            val seller = party.members.first { it.name == "Rune" }
            val steve = party.members.first { it.name == "Steve" }
            sellLoot(
                lootId,
                SellLootRequest(9_500_000_000, "LISTED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), shares = mapOf("Steve" to 3)),
                Clock.System.now(),
            )

            // The payout rows were written from the split in force and are never re-derived, so
            // moving the week now would leave the receipt and the drop above it owing different
            // figures for one night.
            assertEquals(1, findLoot(lootId, partyId)!!.sharesThatWeek[steve.id])
        }
    }

    @Test
    fun `saying who ran a week already pinned leaves the deal it ran under alone`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lastWeek = todayUtc().plus(-DAYS_IN_WEEK, DateTimeUnit.DAY)
            val lootId = addGrindstoneOn(party, lastWeek)
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), shares = mapOf("Steve" to 3)),
                Clock.System.now(),
            )
            val steve = findParty(partyId, userId)!!.members.first { it.name == "Steve" }
            assertEquals(1, findLoot(lootId, partyId)!!.sharesThatWeek[steve.id], "pinned by the edit")

            // The week's rows are REPLACED, and the share rides on them, so answering who ran also
            // handed the night back to today's standing split.
            saveWeekRoster(
                partyId,
                Uuid.parse(party.characterId),
                weekOf(lastWeek),
                listOf("Steve", "Bob"),
                context(),
            )

            assertEquals(1, findLoot(lootId, partyId)!!.sharesThatWeek[steve.id])
        }
    }

    @Test
    fun `a clear on its own leaves the split to the deal that is standing`() {
        transaction {
            val party = trio(difficulty = "HARD")
            val partyId = Uuid.parse(party.id)
            val boss = bossIdForKey("limbo")!!
            // A tick says the party ran, and nothing else. Nothing fell as far as the pool is
            // concerned, so a party cleared and then given a split has no week to have pinned.
            setPartyClear(party, boss, bossResetOf(boss)!!, cleared = true, now = Clock.System.now())

            saveParty(
                userId,
                partyId,
                SavePartyRequest(
                    party.characterId,
                    "limbo",
                    listOf("Steve", "Bob"),
                    shares = mapOf("Steve" to 3),
                    difficulty = "HARD",
                ),
                Clock.System.now(),
            )

            val steve = findParty(partyId, userId)!!.members.first { it.name == "Steve" }
            assertEquals(3, steve.shares)
            assertTrue(lootFor(partyId).isEmpty())
        }
    }

    @Test
    fun `changing what the config says about itself leaves the week alone`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addGrindstoneOn(party, todayUtc())

            // Same party, different mode. Nothing about the week moves, so spelling it out would
            // claim it ran something other than the usual party.
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), difficulty = "HARD"),
                Clock.System.now(),
            )

            val shown = findParty(partyId, userId)!!
            assertTrue(shown.usualRoster)
            assertEquals("HARD", shown.difficulty)
        }
    }

    private fun seatsNamed(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .count()

    private companion object {
        const val DAYS_IN_WEEK = 7
    }
}
