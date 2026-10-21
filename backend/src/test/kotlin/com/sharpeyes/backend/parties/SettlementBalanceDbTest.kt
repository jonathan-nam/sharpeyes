package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.SettlementDebtPayout
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.db.VestigeTrancheShare
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
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * V56 against a real Postgres.
 *
 * Three claims are worth a database. That a sale's attribution comes BACK on the tranche it was
 * written with, since the read is a second query joined by hand and a share landing on the wrong row
 * would credit the wrong person. That removing a mistyped sale takes its attribution with it, which
 * is the cascade: a share of a sale that no longer exists would go on being counted. And that an
 * entered debt is scoped to the account, since it is read without naming a party.
 */
class SettlementBalanceDbTest {
    private val userId = "user_test_settlement_1"
    private val strangerId = "user_test_settlement_2"

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
        val owners = listOf(userId, strangerId)
        transaction {
            // The shares go with their tranches, which is the cascade one of these tests is about.
            VestigeTranche.deleteWhere { VestigeTranche.userId inList owners }
            // A party hangs off a character and its members and loot hang off it, so this takes the
            // payout rows the discharge test wrote with them.
            Characters.deleteWhere { Characters.userId inList owners }
            SettlementDebt.deleteWhere { SettlementDebt.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Users.deleteWhere { Users.id inList owners }
        }
    }

    private fun person(
        owner: String,
        name: String,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        Person.insert {
            it[Person.id] = id
            it[userId] = owner
            it[Person.name] = name
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }

    /** One sale out of your own pile, with `theirs` of its pieces belonging to `creditor`. */
    private fun soldWithShare(
        owner: String,
        creditor: Uuid,
        pieces: Int,
        amount: Long,
        theirs: Int,
    ): Uuid {
        val now = Clock.System.now()
        val trancheId = Uuid.random()
        VestigeTranche.insert {
            it[id] = trancheId
            it[userId] = owner
            it[holderKind] = "SELF"
            it[personId] = null
            it[characterName] = null
            it[VestigeTranche.pieces] = pieces.toDouble()
            it[VestigeTranche.amount] = amount
            it[disposition] = "SOLD"
            it[soldAt] = now
            it[createdAt] = now
        }
        VestigeTrancheShare.insert {
            it[id] = Uuid.random()
            it[VestigeTrancheShare.trancheId] = trancheId
            it[holderKind] = "PERSON"
            it[personId] = creditor
            it[characterName] = null
            it[VestigeTrancheShare.pieces] = theirs.toDouble()
            it[createdAt] = now
        }
        return trancheId
    }

    /** One night with one seat, which is the least a payout row can hang off. */
    private fun nightWithSeat(owner: String): Pair<Uuid, Uuid> {
        val now = Clock.System.now()
        val characterId = Uuid.random()
        Characters.insert {
            it[id] = characterId
            it[userId] = owner
            it[name] = "Splitter"
            it[worldType] = "INTERACTIVE"
            it[position] = 0
            it[createdAt] = now
            it[updatedAt] = now
        }
        // Any seeded boss: this test is about the payout rows, not about which boss they came off.
        val boss = BossCatalog.selectAll().limit(1).single()[BossCatalog.id]
        val partyId = Uuid.random()
        Party.insert {
            it[id] = partyId
            it[userId] = owner
            it[Party.characterId] = characterId
            it[bossCatalogId] = boss
            it[createdAt] = now
            it[updatedAt] = now
        }
        val memberId = Uuid.random()
        PartyMember.insert {
            it[id] = memberId
            it[PartyMember.partyId] = partyId
            it[name] = "Bro"
            it[position] = 0
            it[standing] = true
            it[shares] = 1
        }
        val lootId = Uuid.random()
        PartyLoot.insert {
            it[id] = lootId
            it[PartyLoot.partyId] = partyId
            it[customName] = "Grindstone of Faith"
            it[droppedOn] = LocalDate(2026, 8, 28)
            it[quantity] = 1
            it[createdAt] = now
            it[updatedAt] = now
        }
        return lootId to memberId
    }

    @Test
    fun `a share cannot be discharged by two entries`() {
        // The wrong number this index exists for. Splitting an old offset wrote one night twice,
        // 1,109,227,872 came off a debt once more than it had happened, and every figure on the card
        // stayed plausible. A client guard reads state that goes stale and two tabs share none, so
        // the database is the only place that knows every entry at once. See V68.
        //
        // Raw SQL for the two acts, and deliberately: this is a claim about what POSTGRES refuses,
        // and going through Exposed would test the mapping layer's opinion of it instead.
        val night =
            transaction {
                ensureUser(userId, "settlement@example.com")
                nightWithSeat(userId)
            }
        val (lootId, memberId) = night

        fun discharge() =
            transaction {
                val debtId = Uuid.random()
                exec(
                    "INSERT INTO settlement_debt (id, user_id, holder_kind, character_name, " +
                        "amount, note, incurred_at, created_at) VALUES ('$debtId', '$userId', " +
                        "'CHARACTER', 'bro', -1109227872, 'offset against Bro', now(), now())",
                )
                exec(
                    "INSERT INTO settlement_debt_payout (debt_id, loot_id, member_id) " +
                        "VALUES ('$debtId', '$lootId', '$memberId')",
                )
            }

        discharge()
        // Two transactions, because a failed statement aborts the one it was in: asserting inside
        // the first would leave every later statement failing for that reason instead.
        assertFailsWith<Exception> { discharge() }

        transaction {
            val rows =
                SettlementDebtPayout
                    .selectAll()
                    .where { SettlementDebtPayout.lootId eq lootId }
                    .count()
            assertEquals(1, rows.toInt())
        }
    }

    @Test
    fun `a sale comes back carrying whose pieces it was`() {
        transaction {
            ensureUser(userId, "settlement@example.com")
            val bro = person(userId, "Bro")
            // The night this exists for: 160 fell, 80 were theirs, you looted the lot and sold it.
            soldWithShare(userId, bro, pieces = 160, amount = 4_000_000_000, theirs = 80)
            // A second sale with nobody else's pieces in it, so the join has two rows to tell apart.
            soldWithShare(userId, bro, pieces = 20, amount = 500_000_000, theirs = 20)

            val rows = tranchesFor(userId)
            assertEquals(2, rows.size)
            val big = rows.first { it.pieces == 160.0 }
            assertEquals(1, big.shares.size)
            assertEquals(80.0, big.shares[0].pieces)
            assertEquals(bro.toString(), big.shares[0].holder.personId)
            assertEquals("PERSON", big.shares[0].holder.kind)
            // Their share of the money is never stored, only derivable: 80 of 160 at 4b is 2b.
            assertEquals(20.0, rows.first { it.pieces == 20.0 }.shares[0].pieces)
        }
    }

    @Test
    fun `removing a mistyped sale takes its attribution with it`() {
        transaction {
            ensureUser(userId, "settlement@example.com")
            val bro = person(userId, "Bro")
            val trancheId = soldWithShare(userId, bro, 160, 4_000_000_000, 80)

            VestigeTranche.deleteWhere { VestigeTranche.id eq trancheId }
            // Left behind, a share would go on crediting somebody out of a sale that never happened.
            val left =
                VestigeTrancheShare
                    .selectAll()
                    .where { VestigeTrancheShare.trancheId eq trancheId }
                    .count()
            assertEquals(0, left)
            assertTrue(tranchesFor(userId).isEmpty())
        }
    }

    @Test
    fun `one account never sees another's entered debts`() {
        transaction {
            ensureUser(userId, "settlement@example.com")
            ensureUser(strangerId, "stranger@example.com")
            val mine = person(userId, "Bro")
            val theirs = person(strangerId, "Someone")
            val now = Clock.System.now()

            for (
            (owner, who, amount) in
            listOf(
                Triple(userId, mine, 1_500_000_000L),
                Triple(strangerId, theirs, 9_000_000_000L),
            )
            ) {
                SettlementDebt.insert {
                    it[id] = Uuid.random()
                    it[userId] = owner
                    it[holderKind] = "PERSON"
                    it[personId] = who
                    it[characterName] = null
                    it[SettlementDebt.amount] = amount
                    it[note] = "Ludi loan"
                    it[incurredAt] = now
                    it[createdAt] = now
                }
            }

            val rows = debtsFor(userId)
            assertEquals(1, rows.size)
            assertEquals(1_500_000_000, rows[0].amount)
            assertEquals("Ludi loan", rows[0].note)
            assertEquals(mine.toString(), rows[0].holder.personId)
        }
    }
}
