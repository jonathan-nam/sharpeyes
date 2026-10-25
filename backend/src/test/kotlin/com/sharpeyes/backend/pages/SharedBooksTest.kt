package com.sharpeyes.backend.pages

import com.sharpeyes.api.coupons.CouponSaleShareRow
import com.sharpeyes.api.coupons.SOLD
import com.sharpeyes.api.coupons.VestigeHolder
import com.sharpeyes.api.parties.PartyResponse
import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.VestigePayment
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.parties.PERSON
import com.sharpeyes.backend.parties.SELF
import com.sharpeyes.backend.parties.SharedRow
import com.sharpeyes.backend.parties.TrancheEntry
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.debtsFor
import com.sharpeyes.backend.parties.deleteSharedRow
import com.sharpeyes.backend.parties.findParty
import com.sharpeyes.backend.parties.insertSharedDebt
import com.sharpeyes.backend.parties.insertSharedPayment
import com.sharpeyes.backend.parties.insertSharedTranche
import com.sharpeyes.backend.parties.ownBookRefusal
import com.sharpeyes.backend.parties.paymentRefusal
import com.sharpeyes.backend.parties.paymentsFor
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.parties.sharedBookAt
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
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
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** Somebody else's book, cut to what it says about you. */
class SharedBooksTest {
    private val owner = "user_test_books_owner"
    private val member = "user_test_books_member"
    private val stranger = "user_test_books_stranger"
    private val everyone = listOf(owner, member, stranger)

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
        val owners = everyone
        transaction {
            SettlementDebt.deleteWhere { SettlementDebt.userId inList owners }
            VestigePayment.deleteWhere { VestigePayment.userId inList owners }
            VestigeTranche.deleteWhere { VestigeTranche.userId inList owners }
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private fun character(
        userId: String,
        name: String,
        position: Int = 0,
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
            it[Characters.position] = position
        }
        return id
    }

    /** A person on [of]'s list, signing in as [account]. What accepting an invite writes. */
    private fun link(
        of: String,
        name: String,
        account: String,
    ) {
        savePeople(of, SavePeopleRequest(listOf(PersonRequest(null, name, emptyList()))), Clock.System.now())
        val id = Person.selectAll().where { Person.userId eq of }.single()[Person.id]
        Person.update({ Person.id eq id }) { it[linkedUserId] = account }
    }

    /** The owner's config, seating [members] beside their own character. */
    private fun config(
        ownCharacter: Uuid,
        members: List<String>,
        shares: Map<String, Int> = emptyMap(),
    ): PartyResponse {
        val request = SavePartyRequest(ownCharacter.toString(), "kalos-the-guardian", members, shares)
        val id = createParty(owner, ownCharacter, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
        return findParty(id, owner)!!
    }

    private fun debt(
        personName: String,
        amount: Long,
    ) {
        val person = Person.selectAll().where { (Person.userId eq owner) and (Person.name eq personName) }.single()
        val now = Clock.System.now()
        SettlementDebt.insert {
            it[id] = Uuid.random()
            it[userId] = owner
            it[holderKind] = "PERSON"
            it[personId] = person[Person.id]
            it[characterName] = null
            it[SettlementDebt.amount] = amount
            it[incurredAt] = now
            it[createdAt] = now
        }
    }

    @Test
    fun `a member reads the owner's parties with them in it, and the debts that name them`() {
        transaction {
            val theirs = character(owner, "tidelark")
            character(owner, "Baldrix", position = 1)
            character(member, "Pinewick")
            link(owner, "Chris", member)
            savePeople(
                owner,
                SavePeopleRequest(
                    listOf(
                        PersonRequest(
                            Person
                                .selectAll()
                                .where { Person.userId eq owner }
                                .single()[Person.id]
                                .toString(),
                            "Chris",
                            emptyList(),
                        ),
                        PersonRequest(null, "Felix", listOf("Felixchar")),
                    ),
                ),
                Clock.System.now(),
            )
            val withChris = config(theirs, listOf("Pinewick"))
            val ownOther = character(owner, "Altchar", position = 2)
            config(ownOther, listOf("Felixchar"))
            debt("Chris", 48_000_000_000)
            debt("Felix", 7)

            val books = sharedBooksFor(member)

            val book = books.single()
            assertEquals(listOf(withChris.id), book.parties.map { it.id })
            assertEquals(listOf(48_000_000_000), book.debts.map { it.amount })
            assertEquals("tidelark", book.ownerName)
            assertNull(book.ownerPersonId)
        }
    }

    @Test
    fun `the owner is the member's own person row for them`() {
        transaction {
            val theirs = character(owner, "tidelark")
            character(member, "Pinewick")
            link(owner, "Chris", member)
            link(member, "Kip", owner)
            config(theirs, listOf("Pinewick"))

            val book = sharedBooksFor(member).single()

            val kip = Person.selectAll().where { Person.userId eq member }.single()
            assertEquals("Kip", book.ownerName)
            assertEquals(kip[Person.id].toString(), book.ownerPersonId)
        }
    }

    @Test
    fun `a member writes into the owner's book, and each side takes back only its own`() {
        transaction {
            val theirs = character(owner, "tidelark")
            character(member, "Pinewick")
            character(stranger, "Nobody")
            link(owner, "Chris", member)
            link(member, "Kip", owner)
            config(theirs, listOf("Pinewick"))
            val chris = Person.selectAll().where { Person.userId eq owner }.single()[Person.id]
            val kip = Person.selectAll().where { Person.userId eq member }.single()[Person.id]
            assertNull(sharedBookAt(chris, stranger), "only the person it names writes into it")
            val book = sharedBookAt(chris, member)!!
            val now = Clock.System.now()

            insertSharedDebt(book, member, 10_000_000_000, "carried over", now)
            insertSharedPayment(book, member, 5_000_000_000, null, now)
            insertSharedTranche(
                book,
                member,
                TrancheEntry(60.0, 3_000_000_000, SOLD, listOf(CouponSaleShareRow(VestigeHolder(SELF), 30.0))),
                now,
            )

            // The owner's book names the member as the writer; read as the member, the rows are theirs.
            assertEquals(listOf(false to "Chris"), debtsFor(owner).map { it.recordedByYou to it.recordedByName })
            val asMember = bookBetween(owner, member, chris.toString())
            assertEquals(listOf(true), asMember.debts.map { it.recordedByYou })
            assertEquals(listOf(true), asMember.payments.map { it.recordedByYou })
            assertEquals(
                listOf(30.0),
                asMember.tranches
                    .single()
                    .shares
                    .map { it.pieces },
            )

            // Either way round (V89): the owner paying the member back is the same row, signed.
            insertSharedPayment(book, member, -2_000_000_000, "paid back", now)
            assertEquals(listOf(5_000_000_000, -2_000_000_000), paymentsFor(owner).map { it.amount })
            assertNull(paymentRefusal(VestigeHolder(PERSON, chris.toString()), -2_000_000_000, null))
            assertEquals(
                "amount must be nonzero and at most 1000000000000 either way",
                paymentRefusal(VestigeHolder(PERSON, chris.toString()), 0, null),
            )

            // A second copy of the same debt, in the member's own book, is refused.
            assertEquals("Kip keeps your shared book. Reload and pick them again.", ownBookRefusal(member, kip))
            assertNull(ownBookRefusal(owner, chris), "the owner's book is the shared one")

            // Each side takes back only its own.
            debt("Chris", 7)
            val ownersDebt = SettlementDebt.selectAll().where { SettlementDebt.amount eq 7 }.single()[SettlementDebt.id]
            val membersDebt =
                SettlementDebt
                    .selectAll()
                    .where {
                        SettlementDebt.amount eq 10_000_000_000
                    }.single()[SettlementDebt.id]
            assertFalse(deleteSharedRow(book, member, SharedRow.DEBT, ownersDebt))
            assertTrue(deleteSharedRow(book, member, SharedRow.DEBT, membersDebt))
        }
    }

    @Test
    fun `nobody else reads it`() {
        transaction {
            val theirs = character(owner, "tidelark")
            character(member, "Pinewick")
            character(stranger, "Nobody")
            link(owner, "Chris", member)
            config(theirs, listOf("Pinewick"))
            assertEquals(emptyList(), sharedBooksFor(stranger))
            assertEquals(emptyList(), sharedBooksFor(owner))
        }
    }
}
