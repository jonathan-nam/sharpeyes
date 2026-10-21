package com.sharpeyes.backend.users

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.parties.LootedDrop
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.addLoot
import com.sharpeyes.backend.parties.allLootFor
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.dropIdForKey
import com.sharpeyes.backend.parties.partiesFor
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
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
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * The world lens: an account-wide read answers for ONE world.
 *
 * The failure this pins is not a crash. Without it every list is the two worlds concatenated and
 * every total is their sum, which is a plausible, confident, wrong number: mesos that cannot be
 * earned added to mesos that can, under one heading that names neither.
 *
 * Each read is checked in BOTH modes. A filter written against the wrong column, or compared
 * backwards, passes a one-mode test by returning the right count for the wrong reason.
 */
class WorldLensTest {
    private val userId = "user_test_lens_1"

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
        // Held in a local: inside deleteWhere {} the table is the receiver, so a bare `userId`
        // binds to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owner = userId
        transaction {
            // party_loot and party_member cascade from party, and the character a config hangs off
            // goes after it. Screenshots last: boss_clear cascades with the characters, and a clear
            // pointing at a screenshot is what would otherwise hold that delete up.
            Party.deleteWhere { Party.userId eq owner }
            Characters.deleteWhere { Characters.userId eq owner }
            Screenshots.deleteWhere { Screenshots.userId eq owner }
        }
    }

    /** A character in [world] with one Limbo party, and the party's name for identifying it. */
    private fun characterWithParty(
        name: String,
        world: String,
    ) {
        val owner = userId
        val now = Clock.System.now()
        val id = Uuid.random()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[Characters.worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = if (world == WORLD_HEROIC) 1 else 0
        }
        createParty(owner, id, bossIdForKey("limbo")!!, SavePartyRequest(id.toString(), "limbo", listOf("Steve")), now)
    }

    private fun both() {
        ensureUser(userId, "$userId@example.com")
        characterWithParty("mechobotto", WORLD_INTERACTIVE)
        characterWithParty("Rune", WORLD_HEROIC)
    }

    /** What the character list returns under the current mode. */
    private fun charactersShown(): List<String> =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and inActiveWorld(userId) }
            .orderBy(Characters.position)
            .map { it[Characters.name] }

    @Test
    fun `the character list is one world's`() {
        transaction {
            both()

            setActiveWorld(userId, WORLD_INTERACTIVE)
            assertEquals(listOf("mechobotto"), charactersShown())

            setActiveWorld(userId, WORLD_HEROIC)
            assertEquals(listOf("Rune"), charactersShown())
        }
    }

    @Test
    fun `a party belongs to the world its character is in`() {
        transaction {
            both()

            setActiveWorld(userId, WORLD_INTERACTIVE)
            val interactive = partiesFor(userId)
            assertEquals(1, interactive.size)
            assertEquals(WORLD_INTERACTIVE, interactive.single().worldType)

            setActiveWorld(userId, WORLD_HEROIC)
            val heroic = partiesFor(userId)
            assertEquals(1, heroic.size)
            assertEquals(WORLD_HEROIC, heroic.single().worldType)
        }
    }

    @Test
    fun `the account-wide pool read does not pool two worlds`() {
        transaction {
            both()
            // One drop in each world's pool. This is the read the Wallet and the Drop Log both
            // start from, so a pool that leaks across the lens is a meso total spanning two worlds
            // under a heading that names one.
            for (party in bothPools()) {
                addLoot(
                    Uuid.parse(party),
                    LootedDrop(dropIdForKey("grindstone-of-faith")!!),
                    bossIdForKey("limbo"),
                    LocalDate(2026, 8, 7),
                    Clock.System.now(),
                )
            }

            setActiveWorld(userId, WORLD_INTERACTIVE)
            val interactive = allLootFor(userId)
            assertEquals(1, interactive.size)
            assertEquals(partiesFor(userId).single().id, interactive.single().partyId)

            setActiveWorld(userId, WORLD_HEROIC)
            val heroic = allLootFor(userId)
            assertEquals(1, heroic.size)
            assertEquals(partiesFor(userId).single().id, heroic.single().partyId)

            assertNotEquals(interactive.single().partyId, heroic.single().partyId)
        }
    }

    /** Both worlds' party ids, whichever mode is set. */
    private fun bothPools(): List<String> =
        listOf(WORLD_INTERACTIVE, WORLD_HEROIC).map { world ->
            setActiveWorld(userId, world)
            partiesFor(userId).single().id
        }

    @Test
    fun `a mode with no characters is empty rather than falling back to the other one`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            characterWithParty("mechobotto", WORLD_INTERACTIVE)

            // The tempting bug: treat "no characters here" as "not set up yet" and show everything.
            // That is the toggle silently refusing to do the one thing it does.
            setActiveWorld(userId, WORLD_HEROIC)
            assertEquals(emptyList(), charactersShown())
            assertEquals(emptyList(), partiesFor(userId))
            assertEquals(1, settingsFor(userId).otherWorldCharacters)
        }
    }

    @Test
    fun `an account that never chose a mode is in no world at all`() {
        // Its own user id, never toggled by the tests above: the point is what a row inserted
        // without a world reads as. This test used to assert the opposite, because V26's column
        // default made a new account Interactive and there was no way to say otherwise. V74 drops
        // the default, and null is the difference between an account that chose Interactive and
        // one that was never asked, which is the whole of what the choice screen is drawn on.
        val fresh = "user_test_lens_unanswered"
        transaction {
            ensureUser(fresh, "$fresh@example.com")
            assertNull(Users.selectAll().where { Users.id eq fresh }.single()[Users.worldType])
            assertNull(activeWorldFor(fresh))
            assertNull(settingsFor(fresh).worldType)
            // Not "does anybody trade": there is no world to trade in yet.
            assertEquals(false, settingsFor(fresh).trades)
        }
    }

    @Test
    fun `an unanswered account is shown nothing rather than one world's worth`() {
        // The failure the null exists to prevent. A Heroic player signing up got INTERACTIVE by
        // default, so this read returned their Interactive characters, their Interactive pools and
        // a Sale Ledger for a world that does not trade, with nothing on screen saying so.
        transaction {
            both()
            Users.update({ Users.id eq userId }) { it[worldType] = null }

            assertEquals(emptyList(), charactersShown())
            assertEquals(emptyList(), partiesFor(userId))
            assertEquals(emptyList(), allLootFor(userId))
            // Zero, not two. With no world chosen there is no "here" for a character to be outside
            // of, and a count of the account's own characters under "in the other world" is the
            // toggle offering to move somebody who has not been asked where they are.
            assertEquals(0, settingsFor(userId).otherWorldCharacters)
        }
    }

    @Test
    fun `answering puts the account back in one world`() {
        transaction {
            both()
            Users.update({ Users.id eq userId }) { it[worldType] = null }
            assertEquals(emptyList(), charactersShown())

            setActiveWorld(userId, WORLD_HEROIC)
            assertEquals(listOf("Rune"), charactersShown())
            assertEquals(WORLD_HEROIC, settingsFor(userId).worldType)
        }
    }
}
