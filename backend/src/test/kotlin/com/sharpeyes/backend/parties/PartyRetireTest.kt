package com.sharpeyes.backend.parties

import com.sharpeyes.api.loot.SellLootRequest
import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.bosses.upsertBossClears
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.services.DetectedBossClear
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
 * Taking a config off the lists without taking its pool with it.
 *
 * The claim under all of these is that a drop, a sale and who is owed for it survive the party
 * being removed, and stay reachable by the two readers that answer for money: the wallet and the
 * Drop Log. A debt that quietly stops being owed is the failure this repo exists to prevent, and
 * deleting the config was the one action that could cause it. See V33__party_standing.sql.
 */
class PartyRetireTest {
    private val userId = "user_test_retire_1"
    private val dropped = LocalDate.parse("2026-07-20")

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
        // Held in a local rather than read off the property inside deleteWhere {}: see the same
        // note in PartyLootTest, which once emptied the dev database's characters.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** Your character plus two others, which is three seats: yours is stored as the first. */
    private fun trio(): PartyResponse {
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
        val request = SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"))
        val id = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
        return findParty(id, userId)!!
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

    private fun addGrindstone(party: PartyResponse): Uuid = addGrindstoneOn(party, dropped)

    private fun sale(sellerId: String) = SellLootRequest(9_500_000_000, "LISTED", "FAIR", sellerId)

    @Test
    fun `a party that has held a drop retires rather than deleting, keeping its pool`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            val before = lootFor(partyId).single()

            assertEquals(Removal.RETIRED, retireOrDeleteParty(partyId, userId, Clock.System.now()))

            // The record the retire exists for: the drop, the sale and who is owed for it, all
            // exactly as they were.
            val kept = lootFor(partyId).single()
            assertEquals(lootId.toString(), kept.id)
            assertEquals(before.saleAmount, kept.saleAmount)
            assertEquals(before.payouts, kept.payouts)
            assertTrue(kept.payouts.isNotEmpty())
            // And it is off the lists, but reachable by the two callers that read pools.
            assertTrue(partiesFor(userId).none { it.id == party.id })
            assertTrue(partiesFor(userId, includeRetired = true).any { it.id == party.id })
            assertTrue(allLootFor(userId).any { it.partyId == party.id })
        }
    }

    /** The same trio on a mode, so a clear can file the coupons the catalog guarantees. */
    private fun hardTrio(): PartyResponse {
        val party = trio()
        saveParty(
            userId,
            Uuid.parse(party.id),
            SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob"), difficulty = "HARD"),
            Clock.System.now(),
        )
        return findParty(Uuid.parse(party.id), userId)!!
    }

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

    @Test
    fun `deleting a config takes back the tick it was ticked through`() {
        transaction {
            val party = hardTrio()
            val partyId = Uuid.parse(party.id)
            val boss = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            setPartyClear(party, boss, bossResetOf(boss)!!, cleared = true, now = now)

            // Deleted, not retired: a tick is not a drop, so nothing points at the config.
            assertEquals(Removal.DELETED, retireOrDeleteParty(partyId, userId, now))

            assertNull(findParty(partyId, userId))
            // And the boss is not ticked, so adding the config back starts from nothing said.
            assertNull(clearRow(party, periodStartFor(bossResetOf(boss)!!, now)))
        }
    }

    @Test
    fun `a clear read off a capture survives the config being deleted`() {
        transaction {
            val party = hardTrio()
            val partyId = Uuid.parse(party.id)
            val boss = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val shot = Uuid.random()
            // Held in a local: inside insert {} the TABLE is the receiver, so a bare `userId` is
            // the COLUMN and the row is written with a column reference for a value. Same trap as
            // cleanUp's.
            val owner = userId
            Screenshots.insert {
                it[Screenshots.id] = shot
                it[Screenshots.userId] = owner
                it[Screenshots.characterId] = Uuid.parse(party.characterId)
                it[Screenshots.type] = "PLANNER"
                it[uploadedAt] = now
                it[parseStatus] = "SUCCESS"
            }
            upsertBossClears(
                Uuid.parse(party.characterId),
                listOf(DetectedBossClear("limbo", true)),
                shot,
                now,
            )

            retireOrDeleteParty(partyId, userId, now)

            // A capture read this off the planner. Deleting a config does not unmake a screenshot.
            val kept = clearRow(party, periodStartFor(bossResetOf(boss)!!, now))
            assertEquals(shot, kept?.get(BossClear.sourceScreenshotId))
        }
    }

    @Test
    fun `a tick from an earlier period is left where it is`() {
        transaction {
            val party = hardTrio()
            val partyId = Uuid.parse(party.id)
            val boss = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val lastPeriod = LocalDate.parse("2026-07-16")
            BossClear.insert {
                it[characterId] = Uuid.parse(party.characterId)
                it[bossCatalogId] = boss
                it[periodStart] = lastPeriod
                it[cleared] = true
                it[capturedAt] = now
                it[sourceScreenshotId] = null
            }

            retireOrDeleteParty(partyId, userId, now)

            // A boss killed in July was still killed in July, and the clear matrix draws it.
            assertTrue(clearRow(party, lastPeriod)?.get(BossClear.cleared) == true)
        }
    }

    @Test
    fun `a drop somebody logged still retires the config, with the tick withdrawn`() {
        transaction {
            val party = hardTrio()
            val partyId = Uuid.parse(party.id)
            val boss = bossIdForKey("limbo")!!
            val now = Clock.System.now()
            val lootId = addGrindstone(party)
            setPartyClear(party, boss, bossResetOf(boss)!!, cleared = true, now = now)

            assertEquals(Removal.RETIRED, retireOrDeleteParty(partyId, userId, now))

            // What a human entered is the record the retire exists for. The tick is not.
            assertEquals(listOf(lootId.toString()), lootFor(partyId).map { it.id })
            assertNull(clearRow(party, periodStartFor(bossResetOf(boss)!!, now)))
        }
    }

    @Test
    fun `a party that has never held a drop is deleted outright`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)

            assertEquals(Removal.DELETED, retireOrDeleteParty(partyId, userId, Clock.System.now()))
            assertNull(findParty(partyId, userId))
            assertTrue(partiesFor(userId, includeRetired = true).none { it.id == party.id })
        }
    }

    @Test
    fun `an outstanding payout on a retired party is still owed`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            retireOrDeleteParty(partyId, userId, Clock.System.now())

            // The wallet reads allLootFor against the configs partiesFor hands it. Both sides have
            // to still carry this one, or the debt silently stops existing.
            val pool = allLootFor(userId).single { it.partyId == party.id }
            val unpaid =
                pool.loot
                    .single()
                    .payouts
                    .filterNot { it.paid }
            assertTrue(unpaid.isNotEmpty())
            assertTrue(partiesFor(userId, includeSolo = true, includeRetired = true).any { it.id == party.id })
        }
    }

    @Test
    fun `running a retired boss again revives its config without back-dating the new roster`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            retireOrDeleteParty(partyId, userId, Clock.System.now())

            // Added again with a different roster, which is what picking the boss back up looks
            // like. Steve is gone, Cara is new.
            val again = SavePartyRequest(party.characterId, "limbo", listOf("Bob", "Cara"))
            takeOverParty(userId, partyId, again, Clock.System.now())

            val back = findParty(partyId, userId)!!
            assertFalse(back.retired)
            assertTrue(partiesFor(userId).any { it.id == party.id })
            assertTrue(back.members.any { it.name == "Cara" })
            // One config for the pair, still. A second would give partyIdFor two pools.
            assertEquals(1, partiesFor(userId).count { it.bossKey == "limbo" })

            // The point of the pin: the old drop still reads the roster of the week it FELL in, so
            // Cara is not owed a share of a night she was not there for.
            val ran = lootFor(partyId).single { it.id == lootId.toString() }.ranThatWeek
            val names = back.seats.filter { it.id in ran }.map { it.name }
            assertTrue(names.contains("Steve"))
            assertFalse(names.contains("Cara"))
        }
    }

    @Test
    fun `logging a drop on a retired config brings it back`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addGrindstone(party)
            retireOrDeleteParty(partyId, userId, Clock.System.now())
            assertTrue(partiesFor(userId).none { it.id == party.id })

            // Something fell on it, so it is a boss this character runs after all. Without this the
            // drop would land in a pool Party View does not show while the wallet asked for it.
            addGrindstoneOn(party, dropped)
            assertTrue(partiesFor(userId).any { it.id == party.id })
        }
    }

    @Test
    fun `a drop leaves a retired config retired when a seat has since gone elsewhere`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addGrindstone(party)
            retireOrDeleteParty(partyId, userId, Clock.System.now())

            // Steve takes the boss up with another of your characters while this config is retired.
            // Allowed, and the point of the rule: a retired config holds nobody's clear.
            val other = Uuid.random()
            val owner = userId
            val now = Clock.System.now()
            Characters.insert {
                it[Characters.id] = other
                it[Characters.userId] = owner
                it[Characters.name] = "Kite"
                it[Characters.worldType] = WORLD_INTERACTIVE
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = 1
            }
            val second = SavePartyRequest(other.toString(), "limbo", listOf("Steve"))
            createParty(userId, other, bossIdForKey("limbo")!!, second, now)

            // Now something falls on the old pool. Reviving it would put Steve in two standing
            // configs for a boss he can only clear once, which validateBossRoster refuses at every
            // other door.
            val lootId = addGrindstoneOn(party, dropped)

            // The drop is kept whatever the rosters say: it is a night that happened, and losing a
            // real count to a bookkeeping rule is the failure this repo exists to prevent.
            assertTrue(lootFor(partyId).any { it.id == lootId.toString() })
            // Still readable by the two that answer for money, exactly as any retired pool is.
            assertTrue(
                partiesFor(userId, includeSolo = true, includeRetired = true).any { it.id == party.id },
            )
            // But it does not come back onto Party View double-booked.
            assertTrue(partiesFor(userId).none { it.id == party.id })
        }
    }
}
