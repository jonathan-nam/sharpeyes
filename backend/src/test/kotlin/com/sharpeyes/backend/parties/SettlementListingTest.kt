package com.sharpeyes.backend.parties

import com.sharpeyes.api.vestige.ReportedFigure
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notificationsFor
import com.sharpeyes.backend.users.ensureUser
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** A listing is only good for the figure it was posted for. See SettlementListings.kt. */
class SettlementListingTest {
    private val owner = "user_test_listing_owner"
    private val member = "user_test_listing_member"
    private val stranger = "user_test_listing_stranger"
    private val everyone = listOf(owner, member, stranger)
    private val png = "89504e470d0a1a0a00".hexToByteArray()

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
        cleanUp()
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            // The listings and figures go with the person row.
            Person.deleteWhere { Person.userId inList everyone }
            Notification.deleteWhere { Notification.userId inList everyone }
        }
    }

    /** [member]'s person row on [owner]'s account, linked. */
    private fun card(): Uuid {
        everyone.forEach { ensureUser(it, "$it@example.com") }
        val id = Uuid.random()
        val now = Clock.System.now()
        Person.insert {
            it[Person.id] = id
            it[userId] = owner
            it[name] = "Pellmoor"
            it[pinned] = false
            it[linkedUserId] = member
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }

    private fun kinds(userId: String) = notificationsFor(userId).notifications.map { it.kind }

    @Test
    fun `a changed figure deletes the listing posted for the old one`() {
        transaction {
            val person = card()
            val now = Clock.System.now()
            // The owner sold, so the owner holds the member's share.
            reportFigures(owner, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 300)), now)
            val posted = postListing(listingCardFor(person, member)!!, 300, "image/png", png, now)

            assertEquals(PostOutcome.Posted, posted)
            assertEquals(300, listingsFor(owner).single().amount)
            assertTrue(NotificationKind.LISTING_POSTED in kinds(owner))

            // Another sale: the owner's screen now says 450.
            reportFigures(owner, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 450)), now)

            assertEquals(emptyList(), listingsFor(member))
            assertTrue(NotificationKind.LISTING_POSTED !in kinds(owner))
        }
    }

    @Test
    fun `the payee's own screen deletes a listing for another amount too`() {
        transaction {
            val person = card()
            val now = Clock.System.now()
            postListing(listingCardFor(person, member)!!, 300, "image/png", png, now)

            reportFigures(member, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 0)), now)

            assertEquals(emptyList(), listingsFor(member))
        }
    }

    @Test
    fun `the same figure reported again keeps the listing and tells nobody twice`() {
        transaction {
            val person = card()
            val now = Clock.System.now()
            val figure = listOf(ReportedFigure(person.toString(), PAYER_OWNER, 300))
            reportFigures(owner, figure, now)
            postListing(listingCardFor(person, member)!!, 300, "image/png", png, now)

            reportFigures(owner, figure, now)
            reportFigures(member, figure, now)

            assertEquals(1, listingsFor(owner).size)
            assertEquals(1, kinds(member).count { it == NotificationKind.SPLIT_UPDATED })
        }
    }

    @Test
    fun `a split that moves replaces the payee's entry, and settling clears it`() {
        transaction {
            val person = card()
            val now = Clock.System.now()
            reportFigures(owner, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 300)), now)
            reportFigures(owner, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 450)), now)

            val split = notificationsFor(member).notifications.filter { it.kind == NotificationKind.SPLIT_UPDATED }
            assertEquals(1, split.size)
            assertEquals(
                450,
                split
                    .single()
                    .payload.jsonObject["amount"]!!
                    .jsonPrimitive.long,
            )

            reportFigures(owner, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 0)), now)

            assertTrue(NotificationKind.SPLIT_UPDATED !in kinds(member))
        }
    }

    @Test
    fun `only the payer's report tells the payee`() {
        transaction {
            val person = card()
            reportFigures(member, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 300)), Clock.System.now())

            assertEquals(emptyList(), kinds(member))
        }
    }

    @Test
    fun `a post for a figure the payer's screen does not say is refused`() {
        transaction {
            val person = card()
            val now = Clock.System.now()
            reportFigures(owner, listOf(ReportedFigure(person.toString(), PAYER_OWNER, 300)), now)

            val payee = listingCardFor(person, member)!!

            assertEquals(PostOutcome.Stale, postListing(payee, 250, "image/png", png, now))
            assertEquals(PostOutcome.NothingOwed, postListing(payee, 0, "image/png", png, now))
        }
    }

    @Test
    fun `nobody but the two sides reaches the card or its images`() {
        transaction {
            val person = card()
            postListing(listingCardFor(person, member)!!, 300, "image/png", png, Clock.System.now())
            val id = Uuid.parse(listingsFor(member).single().id)

            assertNull(listingCardFor(person, stranger))
            assertNull(listingImage(id, stranger))
            assertEquals(emptyList(), listingsFor(stranger))
            assertEquals("image/png", listingImage(id, owner)?.first)
            // Only the poster takes one back.
            assertEquals(false, removeListing(id, owner))
            assertEquals(true, removeListing(id, member))
        }
    }

    @Test
    fun `an image is known by its bytes`() {
        assertEquals("image/png", imageTypeOf(png))
        assertEquals("image/jpeg", imageTypeOf("ffd8ffe0".hexToByteArray()))
        assertEquals("image/webp", imageTypeOf("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ".toByteArray()))
        assertNull(imageTypeOf("<svg xmlns=".toByteArray()))
    }
}
