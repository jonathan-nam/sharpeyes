package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
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
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Which drops in a pool are still work, against a real Postgres.
 *
 * The claim worth a database: a drop that comes in pieces is settled through the tranche ledger and
 * never through a sale on its own row, so "not sold" says nothing about it. Reading it as pending
 * put every coupon drop the account had ever had into the pool, permanently, on parties whose split
 * came out exactly even. See LootPoolWork.kt.
 */
class PartyPoolWorkTest {
    private val userId = "user_test_pool_work"
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
        // Held in a local, for the reason PartyLootTest spells out: inside deleteWhere {} a bare
        // `userId` binds to the COLUMN and the predicate takes the whole table.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    @Test
    fun `a coupon drop is only in the pool while somebody else is holding your share`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
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
            // HARD, because whether a drop comes in pieces is per (boss, difficulty). A party with
            // no mode recorded matches no amount and is counted the ordinary way.
            val request =
                SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"), difficulty = "HARD")
            val partyId = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
            addLoot(
                partyId,
                LootedDrop(dropIdForKey("vestige-of-erion")!!),
                bossIdForKey("limbo"),
                dropped,
                now,
            )

            val pending = { lootCountsFor(listOf(partyId), week = null)[partyId]!!.pending }

            // Nobody looted the lot, so the coupons went into the right inventories on the night.
            // This counted for ever before: a piece row never sells, so PENDING never stops.
            assertEquals(0, pending())

            // And none of this touches an ordinary drop, which is work until it sells.
            addLoot(
                partyId,
                LootedDrop(dropIdForKey("grindstone-of-faith")!!),
                bossIdForKey("limbo"),
                dropped,
                now,
            )
            assertEquals(1, pending())
        }
    }

    @Test
    fun `editing the mode does not re-decide what a drop already logged WAS`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val mine = Uuid.random()
            val now = Clock.System.now()
            val owner = userId
            Characters.insert {
                it[Characters.id] = mine
                it[Characters.userId] = owner
                it[Characters.name] = "Kestrel"
                it[Characters.worldType] = WORLD_INTERACTIVE
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = 0
            }
            // HARD, the only Limbo mode the coupon falls at. Normal has no amount for it at all,
            // which is what lets the edit below erase what the drop already was.
            val request =
                SavePartyRequest(mine.toString(), "limbo", listOf("Steve"), difficulty = "HARD")
            val partyId = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
            val lootId =
                addLoot(
                    partyId,
                    LootedDrop(dropIdForKey("vestige-of-erion")!!),
                    bossIdForKey("limbo"),
                    dropped,
                    now,
                )

            val fellAt = {
                PartyLoot.selectAll().where { PartyLoot.id eq lootId }.first()[PartyLoot.difficulty]
            }
            val pending = { lootCountsFor(listOf(partyId), week = null)[partyId]!!.pending }

            // Stamped as it goes in, rather than left to be read off a column that can move.
            assertEquals("HARD", fellAt())
            assertEquals(0, pending())

            // The party moves to Normal, which drops no coupon at all. A night already logged is not
            // up for reinterpretation. Reading the config here took the coupons out of the piece
            // maths and put the row back in the pool as ordinary work, saying nothing. Reported
            // 2026-08-30 as 540 vestiges showing under a Chaos Kalos run.
            saveParty(userId, partyId, request.copy(difficulty = "NORMAL"), now)

            assertEquals("HARD", fellAt())
            assertEquals(0, pending())
        }
    }

    @Test
    fun `a drop with no mode of its own still reads through the config`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
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
            val request =
                SavePartyRequest(mine.toString(), "limbo", listOf("Steve"), difficulty = "HARD")
            val partyId = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
            val lootId =
                addLoot(
                    partyId,
                    LootedDrop(dropIdForKey("vestige-of-erion")!!),
                    bossIdForKey("limbo"),
                    dropped,
                    now,
                )

            // A row from before V69 that the backfill could not place: its count matched no single
            // mode, so it was left unsaid rather than guessed at.
            PartyLoot.update({ PartyLoot.id eq lootId }) { it[difficulty] = null }

            // It goes on reading through the config, which is what every row did before the column
            // existed. Without the fallback the migration would itself take those drops out of the
            // piece maths, which is the bug it is fixing.
            assertEquals(0, lootCountsFor(listOf(partyId), week = null)[partyId]!!.pending)
        }
    }
}
