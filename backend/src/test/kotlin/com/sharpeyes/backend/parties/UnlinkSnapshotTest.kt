package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootPayout
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.VestigePayment
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
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** What an unlink leaves each side: everything they shared, as their own, and nothing taken from either. */
class UnlinkSnapshotTest {
    private val owner = "user_test_snapshot_owner"
    private val member = "user_test_snapshot_member"
    private val everyone = listOf(owner, member)
    private val kalos by lazy { bossIdForKey("kalos-the-guardian")!! }
    private val b = 1_000_000_000L

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
            SettlementDebt.deleteWhere { SettlementDebt.userId inList everyone }
            VestigePayment.deleteWhere { VestigePayment.userId inList everyone }
            Party.deleteWhere { Party.userId inList everyone }
            Person.deleteWhere { Person.userId inList everyone }
            Characters.deleteWhere { Characters.userId inList everyone }
        }
    }

    private fun character(
        userId: String,
        name: String,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    /** Each side's person for the other, linked, the way accepting an invite leaves them. */
    private fun link(): Pair<Uuid, Uuid> {
        fun person(
            of: String,
            name: String,
            account: String,
        ): Uuid {
            savePeople(of, SavePeopleRequest(listOf(PersonRequest(null, name, emptyList()))), Clock.System.now())
            val id = Person.selectAll().where { Person.userId eq of }.single()[Person.id]
            Person.update({ Person.id eq id }) { it[linkedUserId] = account }
            return id
        }
        return person(owner, "Bro", member) to person(member, "Mech", owner)
    }

    private fun money(
        userId: String,
        person: Uuid,
        debt: Long?,
        paid: Long?,
    ) {
        val now = Clock.System.now()
        debt?.let { amount ->
            SettlementDebt.insert {
                it[id] = Uuid.random()
                it[SettlementDebt.userId] = userId
                it[holderKind] = PERSON
                it[personId] = person
                it[SettlementDebt.amount] = amount
                it[note] = "loan"
                it[incurredAt] = now
                it[createdAt] = now
            }
        }
        paid?.let { amount ->
            VestigePayment.insert {
                it[id] = Uuid.random()
                it[VestigePayment.userId] = userId
                it[holderKind] = PERSON
                it[personId] = person
                it[VestigePayment.amount] = amount
                it[receivedAt] = now
                it[createdAt] = now
            }
        }
    }

    /** The night every test below unlinks: a shared Kalos with a sale, a drop of Bro's, money and a copied clear. */
    private class Night(
        val bro: Uuid,
        val mech: Uuid,
        val creed: Uuid,
        val party: Uuid,
        val period: LocalDate,
    )

    private fun night(): Night {
        val mechy = character(owner, "mechyfechy")
        val creed = character(member, "CreedBratton")
        val (bro, mech) = link()
        val request = SavePartyRequest(mechy.toString(), "kalos-the-guardian", listOf("CreedBratton"))
        val party = Uuid.parse(findParty(createParty(owner, mechy, kalos, request, Clock.System.now()), owner)!!.id)
        val seller =
            PartyMember
                .selectAll()
                .where {
                    (PartyMember.partyId eq party) and
                        (PartyMember.name eq "mechyfechy")
                }.single()[PartyMember.id]
        val now = Clock.System.now()
        val sold = addLoot(party, LootedDrop(dropIdForKey("grindstone-of-life")), kalos, todayIn(now), now)
        sellLoot(sold, SellLootRequest(10 * b, "LISTED", "FAIR", seller.toString()), seller, party, now)
        addLoot(
            party,
            LootedDrop(dropIdForKey("exceptional-hammer-eye")),
            kalos,
            todayIn(now),
            now,
            LootSource(recordedBy = member),
        )
        // Bro owes 10b, has paid 3b, and the owner sent 1b back.
        money(owner, bro, debt = 10 * b, paid = 3 * b)
        money(owner, bro, debt = null, paid = -1 * b)
        val period = periodStartFor(WEEKLY_CADENCE, now)
        // A copy of the owner's clear, in place of the one the drops filed for Creed.
        BossClear.deleteWhere {
            (BossClear.characterId eq creed) and (BossClear.bossCatalogId eq kalos) and
                (BossClear.periodStart eq period)
        }
        BossClear.insert {
            it[characterId] = creed
            it[bossCatalogId] = kalos
            it[periodStart] = period
            it[cleared] = true
            it[capturedAt] = now
            it[viaPartyId] = party
        }
        return Night(bro, mech, creed, party, period)
    }

    @Test
    fun `the owner keeps every row, and the member's character stays filed under them`() {
        transaction {
            val night = night()
            val before = PartyLoot.selectAll().where { PartyLoot.partyId eq night.party }.count()

            assertTrue(unlinkPerson(owner, night.bro))

            assertEquals(before, PartyLoot.selectAll().where { PartyLoot.partyId eq night.party }.count())
            assertEquals(
                listOf(10 * b),
                SettlementDebt
                    .selectAll()
                    .where {
                        SettlementDebt.userId eq owner
                    }.map { it[SettlementDebt.amount] },
            )
            assertEquals(listOf("CreedBratton"), namesFiledUnder(owner, night.bro))
            assertTrue(
                Person.selectAll().where { Person.userId inList everyone }.all { it[Person.linkedUserId] == null },
            )
            assertTrue(partiesSeatedIn(member).isEmpty())
        }
    }

    @Test
    fun `the member gets the party as their own, every drop with its sale, and theirs to sell`() {
        transaction {
            val night = night()

            assertTrue(unlinkPerson(owner, night.bro))

            // Their own Kalos, led by Creed, with the owner's character as a seat by name.
            val copy = Party.selectAll().where { (Party.userId eq member) and (Party.bossCatalogId eq kalos) }.single()
            assertEquals(night.creed, copy[Party.characterId])
            val seats =
                PartyMember.selectAll().where { PartyMember.partyId eq copy[Party.id] }.associate {
                    it[PartyMember.name] to
                        it
                }
            assertEquals(night.creed, seats.getValue("CreedBratton")[PartyMember.characterId])
            assertNull(seats.getValue("mechyfechy")[PartyMember.characterId])
            assertNull(seats.getValue("mechyfechy")[PartyMember.linkedCharacterId])

            val copied = PartyLoot.selectAll().where { PartyLoot.partyId eq copy[Party.id] }.toList()
            assertEquals(2, copied.size)
            assertTrue(copied.all { it[PartyLoot.recordedByUserId] == null })
            val sale = copied.single { it[PartyLoot.saleAmount] != null }
            assertEquals(10 * b, sale[PartyLoot.saleAmount])
            assertEquals(seats.getValue("mechyfechy")[PartyMember.id], sale[PartyLoot.sellerMemberId])
            val payout = PartyLootPayout.selectAll().where { PartyLootPayout.lootId eq sale[PartyLoot.id] }.single()
            assertEquals(seats.getValue("CreedBratton")[PartyMember.id], payout[PartyLootPayout.memberId])
            assertEquals(false, payout[PartyLootPayout.paid])
        }
    }

    @Test
    fun `the member gets the money the other way round, and this week's clear as their own`() {
        transaction {
            val night = night()

            assertTrue(unlinkPerson(owner, night.bro))

            val debts = SettlementDebt.selectAll().where { SettlementDebt.userId eq member }.toList()
            assertEquals(listOf(-10 * b), debts.map { it[SettlementDebt.amount] })
            assertTrue(debts.all { it[SettlementDebt.personId] == night.mech })
            assertEquals(
                listOf(-3 * b, 1 * b),
                VestigePayment
                    .selectAll()
                    .where { VestigePayment.userId eq member }
                    .map { it[VestigePayment.amount] }
                    .sorted(),
            )
            assertEquals(listOf("mechyfechy"), namesFiledUnder(member, night.mech))

            val clear =
                BossClear
                    .selectAll()
                    .where {
                        (BossClear.characterId eq night.creed) and
                            (BossClear.periodStart eq night.period)
                    }.single()
            assertEquals(true, clear[BossClear.cleared])
            assertNull(clear[BossClear.viaPartyId])
        }
    }

    @Test
    fun `a run both of them logged keeps the owner's copy, unless the member's has been acted on`() {
        transaction {
            val mechy = character(owner, "mechyfechy")
            val creed = character(member, "CreedBratton")
            val (bro, _) = link()
            val shared = SavePartyRequest(mechy.toString(), "kalos-the-guardian", listOf("CreedBratton"))
            val party = Uuid.parse(findParty(createParty(owner, mechy, kalos, shared, Clock.System.now()), owner)!!.id)
            val own = SavePartyRequest(creed.toString(), "kalos-the-guardian", listOf("Randomguy"), separate = true)
            val theirs = Uuid.parse(findParty(createParty(member, creed, kalos, own, Clock.System.now()), member)!!.id)

            val now = Clock.System.now()
            addLoot(party, LootedDrop(dropIdForKey("grindstone-of-life")), kalos, todayIn(now), now)
            val duplicate = addLoot(theirs, LootedDrop(dropIdForKey("grindstone-of-life")), kalos, todayIn(now), now)

            assertTrue(unlinkPerson(owner, bro))

            // One config per character and boss, so the copy is merged into theirs: their duplicate
            // goes, the owner's copy is there, and the owner's seat joins outside the usual roster.
            assertEquals(
                1,
                Party.selectAll().where { (Party.userId eq member) and (Party.bossCatalogId eq kalos) }.count(),
            )
            val loot = PartyLoot.selectAll().where { PartyLoot.partyId eq theirs }.map { it[PartyLoot.id] }
            assertEquals(1, loot.size)
            assertTrue(duplicate !in loot)
            val mechSeat =
                PartyMember
                    .selectAll()
                    .where {
                        (PartyMember.partyId eq theirs) and
                            (PartyMember.name eq "mechyfechy")
                    }.single()
            assertEquals(false, mechSeat[PartyMember.standing])
        }
    }

    private fun namesFiledUnder(
        userId: String,
        person: Uuid,
    ): List<String> =
        PersonCharacter
            .selectAll()
            .where { (PersonCharacter.userId eq userId) and (PersonCharacter.personId eq person) }
            .map { it[PersonCharacter.name] }
}

/** The copy's share of a coupon sale must be the figure saleCredits (lib/vestige-ledger.ts) computes. */
class ShareOfSaleTest {
    @Test
    fun `rounds to the meso, half up, like Math round`() {
        assertEquals(6_000_000_000, shareOfSale(30.0, 12_000_000_000, 60.0))
        assertEquals(3, shareOfSale(1.0, 10, 3.0)) // 3.33
        assertEquals(3, shareOfSale(1.0, 5, 2.0)) // 2.5, up
        assertEquals(7, shareOfSale(2.0, 10, 3.0)) // 6.67
    }
}
