package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.SellLootRequest
import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
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
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant
import kotlin.uuid.Uuid

/**
 * The loot pool, against a real Postgres.
 *
 * Most of the claims worth a database to check are about the PAYOUT ROSTER: that it is pinned when
 * the drop sells rather than re-read from the party afterwards, that correcting a price does not
 * wipe out who has been paid, and that a seat the roster names cannot be quietly removed. Getting
 * any of those wrong produces a payout list that looks right and owes the wrong people.
 *
 * The rest are about the clear a drop implies: which period it lands in, and what it refuses to
 * overwrite. See clearFromDrop.
 */
class PartyLootTest {
    private val userId = "user_test_loot_1"

    /** A second account, so the account-wide read has something it must not return. */
    private val strangerId = "user_test_loot_2"
    private val dropped = LocalDate.parse("2026-07-20")

    /** The Thursday `dropped` falls after, and the next one. Reset is Thursday 00:00 UTC. */
    private val weekOf20Jul = LocalDate.parse("2026-07-16")
    private val weekAfter20Jul = LocalDate.parse("2026-07-23")

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

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
        // Held in a local, and this is not a style choice. Inside deleteWhere {} the TABLE is a
        // receiver, so a bare `userId` binds to Characters.userId, the COLUMN: the predicate reads
        // userId = userId, which is true of every row, and the delete takes the whole table. A
        // function parameter shadows the receiver and hides this; a class property does not. It
        // emptied the dev database's characters once, and boss_clear and character_token_count
        // cascaded with them.
        val owners = listOf(userId, strangerId)
        transaction {
            // party_loot and party_member cascade from party, and the payout rows cascade from the
            // loot. The character a config hangs off goes last.
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            // After the characters: boss_clear cascades with them, and a clear pointing at a
            // screenshot is what would otherwise hold this delete up.
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** Your character plus two others, which is three seats: yours is stored as the first. */
    private fun trio(world: String = WORLD_INTERACTIVE): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        // A character is inserted here directly, so the account has to say which world it is
        // looking at or every account-wide read below is empty. The route refuses to create a
        // character without one at all: see V74 and users/WorldType.kt.
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val mine = Uuid.random()
        val now = Clock.System.now()
        // Held in a local first: inside insert {} the TABLE is the receiver, so a bare `userId`
        // resolves to Characters.userId, the column, and the insert asks Postgres to store a
        // column reference. A function parameter shadows the receiver and hides this; a class
        // property does not.
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"))
        val id = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
        return findParty(id, userId)!!
    }

    private fun addGrindstone(party: PartyResponse): Uuid {
        val dropId = dropIdForKey("grindstone-of-faith")!!
        return addLoot(Uuid.parse(party.id), LootedDrop(dropId), bossIdForKey("limbo"), dropped, Clock.System.now())
    }

    private fun addGrindstoneOn(
        party: PartyResponse,
        on: LocalDate,
    ): Uuid =
        addLoot(
            Uuid.parse(party.id),
            LootedDrop(dropIdForKey("grindstone-of-faith")!!),
            bossIdForKey("limbo"),
            on,
            Clock.System.now(),
        )

    private fun sale(sellerId: String) = SellLootRequest(9_500_000_000, "LISTED", "FAIR", sellerId)

    /** The same party with Bob out of the usual roster. */
    private fun withoutBob(party: PartyResponse) =
        SavePartyRequest(
            party.characterId,
            "limbo",
            party.members
                .drop(1)
                .filter { it.name != "Bob" }
                .map { it.name },
        )

    /** Seats under this name, retired ones included: the roster read cannot see those. */
    private fun seatsNamed(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .count()

    /** Pays every share on a sold drop, so it lands in `settled`. */
    private fun settle(
        lootId: Uuid,
        partyId: Uuid,
    ) = findLoot(lootId, partyId)!!.payouts.forEach {
        setPayoutPaid(lootId, Uuid.parse(it.memberId), true, Clock.System.now())
    }

    @Test
    fun `a catalog drop carries its name, art and per-member warning onto the row`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val ringId = dropIdForKey("ring-of-restraint-4")!!
            addLoot(partyId, LootedDrop(ringId), bossIdForKey("limbo"), dropped, Clock.System.now())

            val loot = lootFor(partyId).single()
            assertEquals("Ring of Restraint Lv. 4", loot.name)
            assertEquals("/drop-icons/ring-of-restraint-4.png", loot.iconUrl)
            // The flag that stops a party splitting six ways something they each already hold.
            assertEquals("HEROIC", loot.perMember)
            assertEquals("limbo", loot.bossKey)
            assertEquals(STATUS_PENDING, loot.status)
            assertTrue(loot.payouts.isEmpty())
        }
    }

    @Test
    fun `selling owes everyone but the seller, and paying them all closes the drop`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }

            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val sold = findLoot(lootId, partyId)!!
            assertEquals(STATUS_SOLD, sold.status)
            assertEquals(9_500_000_000, sold.saleAmount)
            // The seller is not owed a payout; they are holding the mesos.
            assertEquals(
                party.members
                    .filter { it.name != "Rune" }
                    .map { it.id }
                    .toSet(),
                sold.payouts.map { it.memberId }.toSet(),
            )

            sold.payouts.forEach { setPayoutPaid(lootId, Uuid.parse(it.memberId), true, Clock.System.now()) }
            val closed = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PAID_OUT, closed.status)
            assertTrue(closed.payouts.all { it.paid && it.paidAt != null })
        }
    }

    @Test
    fun `correcting the price leaves who has been paid alone`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val steve = party.members.first { it.name == "Steve" }
            setPayoutPaid(lootId, Uuid.parse(steve.id), true, Clock.System.now())

            // Sold again with a corrected figure and the other split method.
            val corrected = SellLootRequest(8_000_000_000, "RECEIVED", "LAZY", seller.id)
            sellLoot(lootId, corrected, Uuid.parse(seller.id), partyId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals(8_000_000_000, loot.saleAmount)
            assertEquals("RECEIVED", loot.amountBasis)
            assertEquals("LAZY", loot.splitMethod)
            assertEquals(2, loot.payouts.size)
            assertTrue(loot.payouts.single { it.memberId == steve.id }.paid)
        }
    }

    @Test
    fun `a party member buying it owes the same shares a seller would`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val buyer = party.members[0]

            // The buyer holds the value instead of the seller, so they take the same column and
            // are the one seat the payouts skip. The basis is what says no fee came off the top.
            val bought = SellLootRequest(9_500_000_000, "BOUGHT", "FAIR", buyer.id)
            sellLoot(lootId, bought, Uuid.parse(buyer.id), partyId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals("BOUGHT", loot.amountBasis)
            assertEquals(buyer.id, loot.sellerMemberId)
            val owed = party.members.drop(1).map { it.id }
            assertEquals(owed.toSet(), loot.payouts.map { it.memberId }.toSet())
        }
    }

    @Test
    fun `a member who joins after the sale is not owed for it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            // The same config with one more person in it.
            val others = party.members.drop(1).map { it.name } + "Cara"
            val grown = SavePartyRequest(party.characterId, "limbo", others)
            saveParty(userId, partyId, grown, Clock.System.now())

            // Still three seats' worth of history: the fourth was not there when it sold.
            val loot = findLoot(lootId, partyId)!!
            assertEquals(2, loot.payouts.size)
            assertTrue(loot.payouts.none { payout -> payout.memberId !in party.members.map { it.id } })
        }
    }

    @Test
    fun `a seat the loot pool points at leaves the roster but not the record`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            val bob = party.members.first { it.name == "Bob" }
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            // Bob's payout points at his seat, and party_loot_payout cascades on it, so deleting
            // the seat would delete the record while the money stays real. He is RETIRED: out of
            // the roster, still owed.
            saveParty(userId, partyId, withoutBob(party), Clock.System.now())

            assertTrue(findParty(partyId, userId)!!.members.none { it.name == "Bob" })
            val payouts = findLoot(lootId, partyId)!!.payouts
            assertEquals(2, payouts.size)
            assertTrue(payouts.any { it.memberId == bob.id })
        }
    }

    @Test
    fun `a seat nothing points at is deleted rather than kept forever`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)

            // Nothing has dropped and no week names him, so there is nothing to preserve. A
            // misspelling corrected on the day it was typed should not sit in the party for good.
            saveParty(userId, partyId, withoutBob(party), Clock.System.now())

            assertEquals(0, seatsNamed(partyId, "Bob"))
        }
    }

    @Test
    fun `somebody added back takes the seat they had, not a second one`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            val bob = party.members.first { it.name == "Bob" }
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            // Out, then back in. A second seat under the same name would leave the old payout
            // pointing at a Bob who is no longer in the party, beside a Bob who is owed nothing.
            saveParty(userId, partyId, withoutBob(party), Clock.System.now())
            val request = SavePartyRequest(party.characterId, "limbo", party.members.drop(1).map { it.name })
            saveParty(userId, partyId, request, Clock.System.now())

            assertEquals(1, seatsNamed(partyId, "Bob"))
            val back = findParty(partyId, userId)!!.members.first { it.name == "Bob" }
            assertEquals(bob.id, back.id)
            assertTrue(findLoot(lootId, partyId)!!.payouts.any { it.memberId == bob.id })
        }
    }

    @Test
    fun `unselling puts the drop back and takes the payout record with it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            unsellLoot(lootId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PENDING, loot.status)
            assertNull(loot.saleAmount)
            assertNull(loot.sellerMemberId)
            assertTrue(loot.payouts.isEmpty())
            // The seat is free again once nothing points at it.
            assertTrue(seatsWithLootHistory(partyId).isEmpty())
        }
    }

    @Test
    fun `free-text loot is allowed and keeps the name it was given`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addLoot(partyId, LootedDrop(null, "Some untabled mount"), null, dropped, Clock.System.now())

            val loot = lootFor(partyId).single()
            assertEquals("Some untabled mount", loot.name)
            assertNull(loot.dropKey)
            assertNull(loot.iconUrl)
        }
    }

    @Test
    fun `a settled pool is still counted, so the row does not read as empty`() {
        transaction {
            // Paying the last share used to take the pool off the party's row entirely: both
            // counters went to zero and a party with a season of drops behind it looked exactly
            // like one that had never dropped anything.
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }

            addGrindstone(party) // stays in the pool
            val awaiting = addGrindstone(party)
            val done = addGrindstone(party)
            sellLoot(awaiting, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            sellLoot(done, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            findLoot(done, partyId)!!.payouts.forEach {
                setPayoutPaid(done, Uuid.parse(it.memberId), true, Clock.System.now())
            }

            val counts = lootCountsFor(listOf(partyId), week = null)[partyId]!!
            assertEquals(1, counts.pending)
            assertEquals(1, counts.awaitingPayout)
            assertEquals(1, counts.settled)

            // And it reaches the row the party's own page draws, which is all time.
            val row = findParty(partyId, userId)!!
            assertEquals(1, row.pendingLoot)
            assertEquals(1, row.awaitingPayout)
            assertEquals(1, row.settledLoot)
        }
    }

    // The four claims the week rule is made of. Party View's badge sits beside a clear tick that
    // already answers for one week, so a badge counting every drop ever put two periods on one row.
    //
    // `dropped` is 20 Jul 2026, a Monday, so its week is the one starting Thursday the 16th.

    @Test
    fun `a settled drop counts in its own week and in no later one`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }
            val done = addGrindstone(party)
            sellLoot(done, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            settle(done, partyId)

            assertEquals(1, lootCountsFor(listOf(partyId), weekOf20Jul)[partyId]!!.settled)

            // Nothing left to do with it, so it stays in the week it happened in.
            val next = lootCountsFor(listOf(partyId), weekAfter20Jul)[partyId]!!
            assertEquals(0, next.settled)
            assertEquals(0, next.pending)
            assertEquals(0, next.awaitingPayout)
        }
    }

    @Test
    fun `an unsold drop and an unpaid one both carry into later weeks`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }
            addGrindstone(party) // never sold
            val awaiting = addGrindstone(party)
            sellLoot(awaiting, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val own = lootCountsFor(listOf(partyId), weekOf20Jul)[partyId]!!
            assertEquals(1, own.pending)
            assertEquals(1, own.awaitingPayout)

            // Both are work still to do, and a drop that owes somebody money must not fall off the
            // list that shows it just because a Thursday went past.
            val next = lootCountsFor(listOf(partyId), weekAfter20Jul)[partyId]!!
            assertEquals(1, next.pending)
            assertEquals(1, next.awaitingPayout)
        }
    }

    @Test
    fun `nothing carries backwards into a week before the drop fell`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addGrindstone(party)

            // Stepping back must not import a later week's pool, or a week that was quiet reads as
            // one that was not.
            val earlier = lootCountsFor(listOf(partyId), LocalDate.parse("2026-07-09"))[partyId]!!
            assertEquals(0, earlier.pending)
            assertEquals(0, earlier.awaitingPayout)
            assertEquals(0, earlier.settled)
        }
    }

    @Test
    fun `the list defaults to this week and the party's own page does not`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }
            // Far enough back to be several weeks ago whenever this runs.
            val old = addGrindstoneOn(party, todayUtc().minus(60, DateTimeUnit.DAY))
            sellLoot(old, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            settle(old, partyId)

            assertEquals(0, partiesFor(userId).single { it.id == party.id }.settledLoot)
            // Still reachable where it can be corrected or re-split.
            assertEquals(1, findParty(partyId, userId)!!.settledLoot)
        }
    }

    @Test
    fun `the account-wide read is every pool of yours and none of anybody else's`() {
        transaction {
            // Two configs of your own, and a stranger's with loot in it. The wallet nets what you
            // owe against what you are owed, so a pool that leaked in from another account would
            // put somebody else's debt in your total.
            val limbo = trio()
            val mine = Uuid.parse(limbo.characterId)
            val kalos =
                createParty(
                    userId,
                    mine,
                    bossIdForKey("kalos-the-guardian")!!,
                    SavePartyRequest(limbo.characterId, "kalos-the-guardian", listOf("Steve")),
                    Clock.System.now(),
                )
            addGrindstone(limbo)
            addLoot(kalos, LootedDrop(dropIdForKey("grindstone-of-faith")!!), null, dropped, Clock.System.now())
            addLoot(Uuid.parse(strangerParty().id), LootedDrop(null, "Not yours"), null, dropped, Clock.System.now())

            val pools = allLootFor(userId)
            assertEquals(setOf(limbo.id, kalos.toString()), pools.map { it.partyId }.toSet())
            assertEquals(2, pools.sumOf { it.loot.size })
            // The same rows lootFor returns, so the wallet and a party's own page read one shape.
            assertEquals(
                lootFor(Uuid.parse(limbo.id)),
                pools.single { it.partyId == limbo.id }.loot,
            )
        }
    }

    @Test
    fun `settling clears the named rows across parties, whichever seat is owed`() {
        transaction {
            // Paying one person for what they are owed everywhere is ONE transfer, so it is one
            // call. Both directions in it: you sold in the first party, they sold in the second,
            // and the payout row is against a different seat each time.
            val limbo = trio()
            val limboId = Uuid.parse(limbo.id)
            val kalosId =
                createParty(
                    userId,
                    Uuid.parse(limbo.characterId),
                    bossIdForKey("kalos-the-guardian")!!,
                    SavePartyRequest(limbo.characterId, "kalos-the-guardian", listOf("Steve")),
                    Clock.System.now(),
                )
            val kalos = findParty(kalosId, userId)!!

            val yourSale = addGrindstone(limbo)
            val you = limbo.members.first { it.name == "Rune" }
            sellLoot(yourSale, sale(you.id), Uuid.parse(you.id), limboId, Clock.System.now())

            val theirSale =
                addLoot(kalosId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), null, dropped, Clock.System.now())
            val them = kalos.members.first { it.name == "Steve" }
            sellLoot(theirSale, sale(them.id), Uuid.parse(them.id), kalosId, Clock.System.now())

            val refs =
                findLoot(yourSale, limboId)!!.payouts.map { yourSale to Uuid.parse(it.memberId) } +
                    findLoot(theirSale, kalosId)!!.payouts.map { theirSale to Uuid.parse(it.memberId) }

            assertTrue(settlePayouts(userId, refs, Clock.System.now()))
            assertEquals(STATUS_PAID_OUT, findLoot(yourSale, limboId)!!.status)
            assertEquals(STATUS_PAID_OUT, findLoot(theirSale, kalosId)!!.status)
        }
    }

    @Test
    fun `a settle naming a row it cannot reach writes nothing at all`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            val ours = findLoot(lootId, partyId)!!.payouts.map { lootId to Uuid.parse(it.memberId) }

            val stranger = strangerParty()
            val strangerPartyId = Uuid.parse(stranger.id)
            val strangerLoot =
                addLoot(
                    strangerPartyId,
                    LootedDrop(dropIdForKey("grindstone-of-faith")!!),
                    null,
                    dropped,
                    Clock.System.now(),
                )
            val theirSeller = stranger.members.first { it.name == "Stranger" }.id
            sellLoot(
                strangerLoot,
                sale(theirSeller),
                Uuid.parse(theirSeller),
                strangerPartyId,
                Clock.System.now(),
            )
            val theirs =
                findLoot(strangerLoot, strangerPartyId)!!.payouts.map {
                    strangerLoot to Uuid.parse(it.memberId)
                }

            // A seat that is not on this drop's roster, and a row in somebody else's party. Each
            // takes the whole settle down with it: paying for the rows it COULD reach would leave
            // the wallet short by the rest, with nothing on screen saying which.
            assertFalse(settlePayouts(userId, ours + (lootId to Uuid.random()), Clock.System.now()))
            assertFalse(settlePayouts(userId, ours + theirs, Clock.System.now()))

            assertEquals(STATUS_SOLD, findLoot(lootId, partyId)!!.status)
            assertTrue(findLoot(lootId, partyId)!!.payouts.none { it.paid })
            assertTrue(findLoot(strangerLoot, strangerPartyId)!!.payouts.none { it.paid })
        }
    }

    @Test
    fun `settling twice leaves the row that was already paid as it was`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val payouts = findLoot(lootId, partyId)!!.payouts
            val early = payouts.first().memberId
            setPayoutPaid(lootId, Uuid.parse(early), true, Clock.System.now() - 1.days)
            val paidAt = findLoot(lootId, partyId)!!.payouts.single { it.memberId == early }.paidAt

            assertTrue(settlePayouts(userId, payouts.map { lootId to Uuid.parse(it.memberId) }, Clock.System.now()))

            val after = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PAID_OUT, after.status)
            // paidAt is the record of when the money moved. A settle sent twice is one payment,
            // and re-stamping it would date the transfer to the second click.
            assertEquals(paidAt, after.payouts.single { it.memberId == early }.paidAt)
        }
    }

    @Test
    fun `a Heroic world config cannot sell, and says which world it is in`() {
        transaction {
            val heroic = trio(WORLD_HEROIC)
            // Carried on the config, so the client does not have to fetch the character to find
            // out whether this pool's drops are worth a price box.
            assertEquals(WORLD_HEROIC, heroic.worldType)
            assertFalse(partyCanSell(Uuid.parse(heroic.id)))
        }
    }

    @Test
    fun `an Interactive world config still sells`() {
        transaction {
            // The half of the rule that is easy to break by getting the comparison backwards, and
            // which no Heroic test would catch: every existing pool would silently stop selling.
            val party = trio()
            assertEquals(WORLD_INTERACTIVE, party.worldType)
            assertTrue(partyCanSell(Uuid.parse(party.id)))
        }
    }

    @Test
    fun `a drop logged today marks the config cleared`() {
        transaction {
            val party = trio()
            assertNull(findParty(Uuid.parse(party.id), userId)!!.cleared)

            addGrindstoneOn(party, todayUtc())

            val after = findParty(Uuid.parse(party.id), userId)!!
            assertEquals(true, after.cleared)
            // No screenshot behind it, so it reads as a hand tick, which is what it is.
            assertTrue(after.clearedByHand)
        }
    }

    @Test
    fun `a drop is filed against the week it fell in, not the week it was logged`() {
        transaction {
            val party = trio()
            // `dropped` is weeks behind today, so a clear stamped with the request's own date
            // would tick this week for a kill in that one.
            addGrindstone(party)

            val clears = clearsOf(party)
            assertEquals(setOf(weekOf20Jul), clears.keys)
            assertEquals(true, clears[weekOf20Jul])
            // And this week is left saying nothing, rather than saying not cleared.
            assertNull(findParty(Uuid.parse(party.id), userId)!!.cleared)
        }
    }

    @Test
    fun `a drop ticks a week that was answered not cleared`() {
        transaction {
            val party = trio()
            writeClear(party, weekOf20Jul, cleared = false, screenshot = null)

            addGrindstone(party)

            assertEquals(true, clearsOf(party)[weekOf20Jul])
        }
    }

    @Test
    fun `a drop leaves a captured clear alone, screenshot and all`() {
        transaction {
            val party = trio()
            val screenshot = addScreenshot()
            writeClear(party, weekOf20Jul, cleared = true, screenshot = screenshot)

            addGrindstone(party)

            // Rewriting it would null the source and relabel a captured clear as a hand tick, so
            // the row is left exactly as the capture wrote it.
            val row = clearRow(party, weekOf20Jul)!!
            assertTrue(row[BossClear.cleared])
            assertEquals(screenshot, row[BossClear.sourceScreenshotId])
            assertEquals(capturedLongAgo, row[BossClear.capturedAt])
        }
    }

    @Test
    fun `deleting the drop leaves the boss cleared`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)

            deleteLoot(lootId, partyId)

            // Removing the record of what fell says nothing about whether the boss died.
            assertEquals(true, clearsOf(party)[weekOf20Jul])
        }
    }

    /** When the clears written by hand below claim to have been captured. */
    private val capturedLongAgo = Instant.parse("2026-07-20T09:00:00Z")

    /** This config's clears for its own boss, cleared-or-not by period. */
    private fun clearsOf(party: PartyResponse): Map<LocalDate, Boolean> =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq Uuid.parse(party.characterId)) and
                    (BossClear.bossCatalogId eq bossIdForKey("limbo")!!)
            }.associate { it[BossClear.periodStart] to it[BossClear.cleared] }

    private fun clearRow(
        party: PartyResponse,
        period: LocalDate,
    ) = BossClear
        .selectAll()
        .where {
            (BossClear.characterId eq Uuid.parse(party.characterId)) and
                (BossClear.bossCatalogId eq bossIdForKey("limbo")!!) and
                (BossClear.periodStart eq period)
        }.firstOrNull()

    /** A clear already on record, as a capture or a tick would have left it. */
    private fun writeClear(
        party: PartyResponse,
        period: LocalDate,
        cleared: Boolean,
        screenshot: Uuid?,
    ) {
        BossClear.insert {
            it[characterId] = Uuid.parse(party.characterId)
            it[bossCatalogId] = bossIdForKey("limbo")!!
            it[periodStart] = period
            it[BossClear.cleared] = cleared
            it[capturedAt] = capturedLongAgo
            it[sourceScreenshotId] = screenshot
        }
    }

    // boss_clear.source_screenshot_id is a real FK, so a made-up id will not insert.
    private fun addScreenshot(): Uuid {
        val id = Uuid.random()
        val owner = userId
        Screenshots.insert {
            it[Screenshots.id] = id
            it[Screenshots.userId] = owner
            it[uploadedAt] = Clock.System.now()
            it[parseStatus] = "SUCCESS"
            it[type] = "PLANNER"
        }
        return id
    }

    /** A second account with a config of its own, to prove the ownership filter above. */
    private fun strangerParty(): PartyResponse {
        ensureUser(strangerId, "$strangerId@example.com")
        setActiveWorld(strangerId, WORLD_INTERACTIVE)
        val theirs = Uuid.random()
        val now = Clock.System.now()
        val owner = strangerId
        Characters.insert {
            it[Characters.id] = theirs
            it[Characters.userId] = owner
            it[Characters.name] = "Stranger"
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(theirs.toString(), "limbo", listOf("Nobody"))
        return findParty(createParty(strangerId, theirs, bossIdForKey("limbo")!!, request, now), strangerId)!!
    }
}
