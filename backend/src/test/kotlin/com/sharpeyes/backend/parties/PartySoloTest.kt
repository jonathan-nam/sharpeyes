package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.setBossClearByHand
import com.sharpeyes.backend.bosses.setBossRoutine
import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.LocalDate
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
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.uuid.Uuid

/**
 * The pool for a boss run alone, against a real Postgres.
 *
 * Three claims are worth a database. That a solo pool is not a party: it holds drops and appears on
 * no list of parties, or Party View, Run Order and People all start showing arrangements of one.
 * That adding the people you run it with does not back-date them onto what already fell, which
 * would owe a share of a drop to somebody who was not in the game that night. And that a run with
 * nobody else stays one even when its drop is pooled under a party, which is the state the Drop Log
 * puts a partied boss in every time.
 */
class PartySoloTest {
    private val userId = "user_test_solo_1"
    private val dropped = LocalDate.parse("2026-07-20")

    /** The Thursday `dropped` falls after. Reset is Thursday 00:00 UTC. */
    private val weekOf20Jul = LocalDate.parse("2026-07-16")

    /** A night the week after, for telling a week somebody was on from one they had already left. */
    private val droppedLater = LocalDate.parse("2026-07-27")
    private val weekOf27Jul = LocalDate.parse("2026-07-23")

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
        // Held in a local, not used bare: inside deleteWhere {} the table is the receiver, so a
        // bare `userId` binds to the COLUMN and the predicate matches every row. See PartyLootTest.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** One character of this account, and nothing else. */
    private fun character(name: String = "Rune"): Uuid {
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
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun logGrindstone(
        characterId: Uuid,
        on: LocalDate = dropped,
    ): Pair<Uuid, Uuid> {
        val now = Clock.System.now()
        val bossId = bossIdForKey("limbo")!!
        val partyId = poolFor(userId, characterId, bossId, now)
        val lootId = addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, on, now)
        return partyId to lootId
    }

    @Test
    fun `a drop on a boss run alone opens a pool that is not a party`() {
        transaction {
            val characterId = character()
            val (partyId, _) = logGrindstone(characterId)

            val pool = findParty(partyId, userId)!!
            assertTrue(pool.solo)
            // One seat, and it is the character itself, so a sale has somebody to be sold by.
            assertEquals(listOf(characterId.toString()), pool.seats.map { it.characterId })
            assertEquals(1, lootFor(partyId).size)

            // The list every party screen reads must not have it, and the one the Drop Log reads
            // must: those drops have no seats to be read against without their config.
            assertTrue(partiesFor(userId).none { it.id == partyId.toString() })
            assertTrue(partiesFor(userId, includeSolo = true).any { it.id == partyId.toString() })
        }
    }

    @Test
    fun `a second drop on the same boss goes in the pool that is already open`() {
        transaction {
            val characterId = character()
            val (first, _) = logGrindstone(characterId)
            val (second, _) = logGrindstone(characterId)

            assertEquals(first, second)
            assertEquals(2, lootFor(first).size)
        }
    }

    @Test
    fun `a drop on a boss this character has a party for goes in the party's pool`() {
        transaction {
            val characterId = character()
            val now = Clock.System.now()
            val bossId = bossIdForKey("limbo")!!
            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            val partyId = createParty(userId, characterId, bossId, request, now)

            // Same pool, and no solo config beside it: two pools for one character on one boss
            // would split a history nothing could add back up.
            assertEquals(partyId, poolFor(userId, characterId, bossId, now))
            assertEquals(1, partiesFor(userId, includeSolo = true).count { it.characterId == characterId.toString() })
        }
    }

    @Test
    fun `naming who you run it with turns the pool into that party, keeping its drops`() {
        transaction {
            val characterId = character()
            val (partyId, _) = logGrindstone(characterId)

            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            adoptSoloParty(userId, partyId, request, Clock.System.now())

            val party = findParty(partyId, userId)!!
            assertEquals(false, party.solo)
            assertEquals(listOf("Rune", "Steve"), party.seats.map { it.name })
            // The pool is the same pool. Refusing the edit and making a second config would have
            // left the history behind on a row nothing lists.
            assertEquals(1, lootFor(partyId).size)
            assertTrue(partiesFor(userId).any { it.id == partyId.toString() })
        }
    }

    @Test
    fun `a member added afterwards is not owed a share of what fell before they were there`() {
        transaction {
            val characterId = character()
            val (partyId, lootId) = logGrindstone(characterId)
            val alone = findParty(partyId, userId)!!.seats.single().id

            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            adoptSoloParty(userId, partyId, request, Clock.System.now())

            val sale = SellLootRequest(9_500_000_000, "LISTED", "FAIR", alone)
            sellLoot(lootId, sale, Uuid.parse(alone), partyId, Clock.System.now())

            // The whole claim: that week ran alone, so the sale owes nobody. Read from the pinned
            // roster rather than from the party as it stands, which now has Steve in it.
            assertTrue(findLoot(lootId, partyId)!!.payouts.isEmpty())
            assertEquals(listOf(Uuid.parse(alone)), rosterFor(partyId, weekOf20Jul))
        }
    }

    @Test
    fun `naming the mode opens the pool before anything has fallen in it`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!

            val partyId = setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "HARD", Clock.System.now())!!

            val pool = findParty(partyId, userId)!!
            assertTrue(pool.solo)
            assertEquals("HARD", pool.difficulty)
            // Empty, and stays empty until a clear or a human puts something in it. Naming the mode
            // is not a claim that the boss has been run.
            assertTrue(lootFor(partyId).isEmpty())
        }
    }

    private fun couponIn(partyId: Uuid) = lootFor(partyId).single { it.dropKey == "vestige-of-erion" }

    @Test
    fun `a mode named after the clear was ticked files that period's coupons`() {
        transaction {
            val characterId = character()
            val now = Clock.System.now()
            // The ordinary order: the boss is ticked, and nothing can be filed because nobody has
            // said which mode. Without this the coupons would be missing until the next reset.
            assertTrue(setBossClearByHand(userId, characterId, "limbo", true, now))

            val partyId = setSoloDifficulty(userId, characterId, bossIdForKey("limbo")!!, "WEEKLY", "HARD", now)!!

            assertEquals(60, couponIn(partyId).quantity)
        }
    }

    @Test
    fun `correcting the mode re-files rather than leaving the count the old one gave`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("kaling")!!
            val now = Clock.System.now()
            setBossClearByHand(userId, characterId, "kaling", true, now)

            setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "HARD", now)
            val partyId = partyIdFor(characterId, bossId)!!
            assertEquals(60, couponIn(partyId).quantity)

            // Extreme Kaling gives 480. The 60 is a row the app filed itself and its premise has
            // changed, so it goes rather than sitting beside the new one.
            setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "EXTREME", now)
            assertEquals(480, couponIn(partyId).quantity)

            // And a mode that drops no coupons leaves none.
            setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "EASY", now)
            assertTrue(lootFor(partyId).isEmpty())
        }
    }

    @Test
    fun `a boss with a party keeps its mode on the party`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val request =
                SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"), difficulty = "HARD")
            val partyId = createParty(userId, characterId, bossId, request, now)

            // Refused, not applied. The party's mode is read beside its roster and its split, and
            // this door sees neither.
            assertNull(setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "NORMAL", now))
            assertEquals("HARD", findParty(partyId, userId)!!.difficulty)
        }
    }

    @Test
    fun `a boss whose party was retired can be given a mode as one run alone`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val request =
                SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"), difficulty = "HARD")
            val partyId = createParty(userId, characterId, bossId, request, now)
            addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, dropped, now)
            // Kept, not deleted: it holds a drop. Which left the pair with a config on no list, and
            // no way to say the boss is run alone now, since a party needs somebody else in it.
            assertEquals(Removal.RETIRED, retireOrDeleteParty(partyId, userId, now))

            assertEquals(partyId, setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "NORMAL", now))

            val pool = findParty(partyId, userId)!!
            assertTrue(pool.solo)
            assertEquals("NORMAL", pool.difficulty)
            // Back on the list the routine editor reads, which leaves retired configs out.
            assertTrue(partiesFor(userId, includeSolo = true).any { it.id == partyId.toString() })
            // One seat from now on, so what a clear files divides by one.
            assertEquals(listOf(characterId.toString()), pool.members.map { it.characterId })
            // The night it was a duo keeps both of them. Steve is off the roster, not out of it.
            assertEquals(2, pool.seats.size)
            assertEquals(2, rosterFor(partyId, weekOf20Jul).size)
        }
    }

    @Test
    fun `the period being answered does not keep the retired party's roster`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val request =
                SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"), difficulty = "HARD")
            val partyId = createParty(userId, characterId, bossId, request, now)
            addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, dropped, now)
            retireOrDeleteParty(partyId, userId, now)
            // The order that got this wrong: the boss is ticked cleared before anybody says what mode
            // it is run at, so the period counts as written and the pin reached it.
            assertTrue(setBossClearByHand(userId, characterId, "limbo", true, now))

            setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "HARD", now)

            // Alone this week, so the 60 coupons the clear just filed are undivided.
            assertEquals(60, couponIn(partyId).quantity)
            assertEquals(1, rosterFor(partyId, currentWeek()).size)
            assertEquals(listOf(characterId.toString()), findParty(partyId, userId)!!.members.map { it.characterId })
            // The night it was a duo still has both, which is what the pin is for.
            assertEquals(2, rosterFor(partyId, weekOf20Jul).size)
        }
    }

    @Test
    fun `a boss whose one-off period has passed can be given a mode as one run alone`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!
            val night = Clock.System.now()
            val request =
                SavePartyRequest(
                    characterId.toString(),
                    "limbo",
                    listOf("Steve"),
                    difficulty = "HARD",
                    oneOff = true,
                )
            val partyId = createParty(userId, characterId, bossId, request, night)
            addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, dropped, night)
            // A week on, so the night it was armed for is over. The config still holds the pair's
            // slot, and a party needs somebody else in it, so refusing here left the boss with no
            // way to say it is run alone now.
            val later = night.plus(7.days)

            assertEquals(partyId, setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "NORMAL", later))

            val pool = findParty(partyId, userId)!!
            assertTrue(pool.solo)
            // A pool is on every period, unlike the night this was.
            assertFalse(pool.oneOff)
            assertEquals("NORMAL", pool.difficulty)
            // One seat from the week this was said in, so what a clear files there divides by one.
            assertEquals(1, rosterFor(partyId, weekOf(todayIn(later))).size)
            // Steve is off the roster, not out of it. The night he ran keeps both seats, which is
            // the week the one-off was armed for: selling that night's drop later must not read the
            // roster as it stands now and owe nobody a share.
            assertEquals(2, pool.seats.size)
            assertEquals(2, rosterFor(partyId, weekOf(todayIn(night))).size)
            // The grindstone above fell in a week this config was never armed for, so it was not
            // that night and divides by one. A one-off's people are written onto its own week and
            // stand in no other. See writeNightRoster.
            assertEquals(1, rosterFor(partyId, weekOf20Jul).size)
        }
    }

    @Test
    fun `a one-off still on its own period keeps its mode on the party`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val request =
                SavePartyRequest(
                    characterId.toString(),
                    "limbo",
                    listOf("Steve"),
                    difficulty = "HARD",
                    oneOff = true,
                )
            val partyId = createParty(userId, characterId, bossId, request, now)

            // This period it IS who they run it with, so the mode stays where the roster and the
            // split can be read beside it.
            assertNull(setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "NORMAL", now))
            assertEquals("HARD", findParty(partyId, userId)!!.difficulty)
        }
    }

    @Test
    fun `a night run alone after they left is not handed them back by the pin`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val request =
                SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"), difficulty = "HARD")
            val partyId = createParty(userId, characterId, bossId, request, now)
            addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, dropped, now)
            retireOrDeleteParty(partyId, userId, now)
            // Steve stops standing here. His seat stays, because the July night points at it.
            setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "HARD", now)
            val mine = findParty(partyId, userId)!!.members.single().id

            // A later night, run alone. It spells out no roster of its own, so it already reads the
            // standing one, which is a seat of one.
            addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, droppedLater, now)
            assertEquals(listOf(Uuid.parse(mine)), rosterFor(partyId, weekOf27Jul))

            adoptSoloParty(
                userId,
                partyId,
                SavePartyRequest(characterId.toString(), "limbo", listOf("Alex")),
                now,
            )

            // The claim: the pin holds every week where it already was. The duo night keeps both,
            // and the night run alone stays alone. Reading every seat ROW instead put Steve back on
            // a week he had already left, which halves the share and asks for the difference for
            // good: the drop divides two ways, and the second seat was never there.
            assertEquals(2, rosterFor(partyId, weekOf20Jul).size)
            assertEquals(listOf(Uuid.parse(mine)), rosterFor(partyId, weekOf27Jul))
        }
    }

    @Test
    fun `a boss run alone is not a party the routine editor has to be argued with`() {
        transaction {
            val characterId = character()
            logGrindstone(characterId)

            // A config locks the boss on /bosses/routine, because a party is a standing claim that
            // this character runs it. A pool of one drop is not, and there would be nothing to
            // "remove first" if it refused.
            assertNull(setBossRoutine(userId, characterId, listOf("limbo"), Clock.System.now()))
        }
    }

    @Test
    fun `a drop logged on a boss with a party is still a run with nobody else`() {
        transaction {
            val characterId = character()
            val now = Clock.System.now()
            val bossId = bossIdForKey("limbo")!!
            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            val partyId = createParty(userId, characterId, bossId, request, now)
            val mine = findParty(partyId, userId)!!.seats.first { it.characterId == characterId.toString() }.id

            // What the Drop Log's own form writes. It names nobody, so the row says nobody else was
            // there, and the pool it happens to sit in does not get to answer that question.
            val grindstone = LootedDrop(dropIdForKey("grindstone-of-faith")!!)
            val lootId = addLoot(partyId, grindstone, bossId, dropped, now, LootSource(solo = true))

            assertEquals(listOf(mine), findLoot(lootId, partyId)!!.ranThatWeek)

            sellLoot(lootId, SellLootRequest(9_500_000_000, "LISTED", "FAIR", mine), Uuid.parse(mine), partyId, now)
            // The failure this exists to stop: half of a solo kill owed to Steve, who was not in
            // the game, on a drop entered through the button that asks about neither.
            assertTrue(findLoot(lootId, partyId)!!.payouts.isEmpty())
        }
    }

    @Test
    fun `a drop added on the party is still divided by the party`() {
        transaction {
            val characterId = character()
            val now = Clock.System.now()
            val bossId = bossIdForKey("limbo")!!
            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            val partyId = createParty(userId, characterId, bossId, request, now)
            val seats = findParty(partyId, userId)!!.seats
            val mine = seats.first { it.characterId == characterId.toString() }.id

            // The other door, unchanged: this one names the party, so the party is what it divides
            // by. Both are worth a test, because the fix for one is a way to break the other.
            val grindstone = LootedDrop(dropIdForKey("grindstone-of-faith")!!)
            val lootId = addLoot(partyId, grindstone, bossId, dropped, now)

            assertEquals(seats.map { it.id }.toSet(), findLoot(lootId, partyId)!!.ranThatWeek.toSet())

            sellLoot(lootId, SellLootRequest(9_500_000_000, "LISTED", "FAIR", mine), Uuid.parse(mine), partyId, now)
            val steve = seats.first { it.name == "Steve" }.id
            assertEquals(listOf(steve), findLoot(lootId, partyId)!!.payouts.map { it.memberId })
        }
    }
}
