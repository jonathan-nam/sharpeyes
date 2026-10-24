package com.sharpeyes.backend.friends

import com.sharpeyes.api.parties.PersonRequest
import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.api.parties.SavePeopleRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.DiscordUsername
import com.sharpeyes.backend.db.FriendRequest
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notificationsFor
import com.sharpeyes.backend.pages.sharedBooksFor
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.peopleFor
import com.sharpeyes.backend.parties.savePeople
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
import org.jetbrains.exposed.v1.jdbc.transactions.TransactionManager
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.uuid.Uuid

class FriendsTest {
    private val wren = "user_test_friends_wren"
    private val owen = "user_test_friends_owen"
    private val everyone = listOf(wren, owen)

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
            FriendRequest.deleteWhere { FriendRequest.fromUserId inList everyone }
            Notification.deleteWhere { Notification.userId inList everyone }
            SettlementDebt.deleteWhere { SettlementDebt.userId inList everyone }
            Party.deleteWhere { Party.userId inList everyone }
            Person.deleteWhere { Person.userId inList everyone }
            Characters.deleteWhere { Characters.userId inList everyone }
            DiscordUsername.deleteWhere { DiscordUsername.discordId inList everyone.map { "discord-$it" } }
            exec("""DELETE FROM auth_user WHERE id IN ('$wren', '$owen')""")
        }
    }

    /** An account that has signed in with Discord as [username]. */
    private fun discordAccount(
        userId: String,
        username: String,
        vararg characters: String,
    ): List<Uuid> {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        TransactionManager.current().exec(
            """INSERT INTO auth_user (id, name, email, "emailVerified") VALUES ('$userId', '$username', '$userId@x.test', true);
               INSERT INTO auth_account (id, issuer, "accountId", "providerId", "userId", "updatedAt")
               VALUES ('acct-$userId', 'https://discord.com', 'discord-$userId', 'discord', '$userId', now())""",
        )
        DiscordUsername.insert {
            it[discordId] = "discord-$userId"
            it[DiscordUsername.username] = username
            it[updatedAt] = Clock.System.now()
        }
        return characters.mapIndexed { i, name ->
            val id = Uuid.random()
            Characters.insert {
                it[Characters.id] = id
                it[Characters.userId] = userId
                it[Characters.name] = name
                it[worldType] = WORLD_INTERACTIVE
                it[createdAt] = Clock.System.now()
                it[updatedAt] = Clock.System.now()
                it[position] = i
            }
            id
        }
    }

    private fun personOf(
        owner: String,
        other: String,
    ) = Person
        .selectAll()
        .where { (Person.userId eq owner) and (Person.linkedUserId eq other) }
        .singleOrNull()
        ?.get(Person.name)

    @Test
    fun `a request accepted links both accounts, reusing the person who already holds their characters`() {
        transaction {
            val (warrior) = discordAccount(wren, "wrenb", "orchid88")
            val (pine) = discordAccount(owen, "owendiscord", "Pinewick")
            savePeople(
                wren,
                SavePeopleRequest(listOf(PersonRequest(null, "Owen", listOf("Pinewick")))),
                Clock.System.now(),
            )
            val request = SavePartyRequest(warrior.toString(), "kalos-the-guardian", listOf("Pinewick"))
            val party = createParty(wren, warrior, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())

            assertEquals(SendOutcome.Sent, sendFriendRequest(wren, " @OwenDiscord ", Clock.System.now()))
            val asked = notificationsFor(owen).notifications.single()
            assertEquals(NotificationKind.FRIEND_REQUEST, asked.kind)
            assertEquals("wrenb", asked.actor?.username)
            assertEquals("orchid88", asked.actor?.name)
            assertEquals(1, notificationsFor(owen).unread)

            acceptFriendRequest(owen, Uuid.parse(asked.subjectId!!), Clock.System.now())

            assertEquals("Owen", personOf(wren, owen))
            assertEquals("orchid88", personOf(owen, wren))
            val seat =
                PartyMember
                    .selectAll()
                    .where {
                        (PartyMember.partyId eq party) and
                            (PartyMember.name eq "Pinewick")
                    }.single()
            assertEquals(pine, seat[PartyMember.linkedCharacterId])
            assertEquals(listOf("Owen"), socialFor(wren).friends.map { it.name })
            // The request is answered, so it is off Owen's bell, and Wren hears it was accepted.
            assertEquals(emptyList(), notificationsFor(owen).notifications)
            assertEquals(
                listOf(NotificationKind.FRIEND_ACCEPTED),
                notificationsFor(wren).notifications.map { it.kind },
            )
        }
    }

    @Test
    fun `asking somebody who already asked you accepts them`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            sendFriendRequest(wren, "owendiscord", Clock.System.now())

            assertEquals(SendOutcome.Accepted, sendFriendRequest(owen, "wrenb", Clock.System.now()))
            assertEquals(SendOutcome.AlreadyFriends, sendFriendRequest(wren, "owendiscord", Clock.System.now()))
            assertEquals("Pinewick", personOf(wren, owen))
        }
    }

    @Test
    fun `declining or cancelling clears the notification, and asking twice notifies once`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            sendFriendRequest(wren, "owendiscord", Clock.System.now())
            sendFriendRequest(wren, "owendiscord", Clock.System.now())
            val asked = notificationsFor(owen).notifications.single()

            dropFriendRequest(wren, Uuid.parse(asked.subjectId!!))

            assertEquals(emptyList(), notificationsFor(owen).notifications)
        }
    }

    @Test
    fun `a typed name is looked up the way a request matches it, and shows who it will reach`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")

            val found = lookupFor(wren, " @OwenDiscord ")!!
            assertEquals("owendiscord", found.username)
            assertEquals("Pinewick", found.name)
            assertEquals(false, found.you)
            assertEquals(true, lookupFor(wren, "wrenb")!!.you)
            assertNull(lookupFor(wren, "nobody-by-this-name"))
        }
    }

    @Test
    fun `nobody, or yourself, is refused`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")

            assertEquals(SendOutcome.Unknown, sendFriendRequest(wren, "nobody-by-this-name", Clock.System.now()))
            assertEquals(SendOutcome.Yourself, sendFriendRequest(wren, "WrenB", Clock.System.now()))
        }
    }

    /** Saves [names] as [owner]'s people, characterless, and answers their ids by name. */
    private fun people(
        owner: String,
        vararg names: String,
    ): Map<String, Uuid> {
        savePeople(
            owner,
            SavePeopleRequest(names.map { PersonRequest(null, it, emptyList()) }),
            Clock.System.now(),
        )
        return Person
            .selectAll()
            .where { Person.userId eq owner }
            .associate { it[Person.name] to it[Person.id] }
    }

    @Test
    fun `a request sent from a person links that person, not a guessed one`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            // Neither holds Owen's characters, so without the pin a new person would be made.
            val ids = people(wren, "Owl", "Bro")

            assertEquals(SendOutcome.Sent, sendFriendRequest(wren, "owendiscord", Clock.System.now(), ids["Owl"]))
            val waiting = peopleFor(wren).single { it.name == "Owl" }.request
            assertEquals("owendiscord", waiting?.username)
            assertNull(peopleFor(wren).single { it.name == "Bro" }.request)

            acceptFriendRequest(owen, Uuid.parse(waiting!!.id), Clock.System.now())

            assertEquals("Owl", personOf(wren, owen))
            assertEquals(listOf("Bro", "Owl"), peopleFor(wren).map { it.name }.sorted())
            assertNull(peopleFor(wren).single { it.name == "Owl" }.request)
        }
    }

    @Test
    fun `asking a second account for the same person replaces the first request`() {
        val third = "user_test_friends_third"
        transaction {
            try {
                discordAccount(wren, "wrenb", "orchid88")
                discordAccount(owen, "owendiscord", "Pinewick")
                discordAccount(third, "thirdperson", "Larkspur")
                val owl = people(wren, "Owl").getValue("Owl")

                sendFriendRequest(wren, "owendiscord", Clock.System.now(), owl)
                sendFriendRequest(wren, "thirdperson", Clock.System.now(), owl)

                assertEquals(listOf("thirdperson"), socialFor(wren).outgoing.map { it.username })
                assertEquals("thirdperson", peopleFor(wren).single().request?.username)
                assertEquals(emptyList(), notificationsFor(owen).notifications)
            } finally {
                Notification.deleteWhere { Notification.userId eq third }
                Characters.deleteWhere { Characters.userId eq third }
                DiscordUsername.deleteWhere { DiscordUsername.discordId eq "discord-$third" }
                exec("""DELETE FROM auth_user WHERE id = '$third'""")
            }
        }
    }

    @Test
    fun `a person already linked, or somebody else's, is refused`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            val owl = people(wren, "Owl").getValue("Owl")
            val theirs = people(owen, "Robin").getValue("Robin")
            Person.update({ Person.id eq owl }) { it[linkedUserId] = owen }

            assertEquals(SendOutcome.PersonLinked, sendFriendRequest(wren, "owendiscord", Clock.System.now(), owl))
            assertEquals(SendOutcome.NoSuchPerson, sendFriendRequest(wren, "owendiscord", Clock.System.now(), theirs))
            assertEquals(emptyList(), socialFor(wren).outgoing)
        }
    }

    @Test
    fun `asking back from a person accepts, and each side keeps the person it named`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            val robin = people(owen, "Robin").getValue("Robin")
            val owl = people(wren, "Owl").getValue("Owl")
            sendFriendRequest(owen, "wrenb", Clock.System.now(), robin)

            assertEquals(SendOutcome.Accepted, sendFriendRequest(wren, "owendiscord", Clock.System.now(), owl))

            assertEquals("Owl", personOf(wren, owen))
            assertEquals("Robin", personOf(owen, wren))
        }
    }

    /** A debt on [owner]'s book naming their person [personName], dated [daysFromNow] from now. */
    private fun debt(
        owner: String,
        personName: String,
        amount: Long,
        daysFromNow: Int,
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
            it[incurredAt] = now + daysFromNow.days
            it[createdAt] = now
        }
    }

    /** The debt amounts [reader] reads on other accounts' books. */
    private fun debtsReadBy(reader: String) = sharedBooksFor(reader).flatMap { it.debts }.map { it.amount }.toSet()

    @Test
    fun `two accounts that each kept a book read each other only from after the link`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            val owl = people(wren, "Owl").getValue("Owl")
            people(owen, "Robin")
            // Both books already hold this, so Owen reading Wren's copy would count it twice.
            debt(wren, "Owl", 100, daysFromNow = -3)

            sendFriendRequest(wren, "owendiscord", Clock.System.now(), owl)
            acceptFriendRequest(owen, requestFrom(wren), Clock.System.now())
            debt(wren, "Owl", 200, daysFromNow = 2)

            assertEquals(setOf(200L), debtsReadBy(owen))
        }
    }

    @Test
    fun `an account that arrived with no book of its own reads the whole of the other's`() {
        transaction {
            discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            val owl = people(wren, "Owl").getValue("Owl")
            debt(wren, "Owl", 100, daysFromNow = -3)

            sendFriendRequest(wren, "owendiscord", Clock.System.now(), owl)
            acceptFriendRequest(owen, requestFrom(wren), Clock.System.now())

            assertEquals(setOf(100L), debtsReadBy(owen))
        }
    }

    private fun requestFrom(from: String) =
        FriendRequest.selectAll().where { FriendRequest.fromUserId eq from }.single()[FriendRequest.id]

    @Test
    fun `removing a friend unlinks both sides and takes the seats back`() {
        transaction {
            val (warrior) = discordAccount(wren, "wrenb", "orchid88")
            discordAccount(owen, "owendiscord", "Pinewick")
            val request = SavePartyRequest(warrior.toString(), "kalos-the-guardian", listOf("Pinewick"))
            val party = createParty(wren, warrior, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
            sendFriendRequest(wren, "owendiscord", Clock.System.now())
            sendFriendRequest(owen, "wrenb", Clock.System.now())
            val friend = socialFor(owen).friends.single()

            removeFriend(owen, Uuid.parse(friend.id))

            assertNull(personOf(wren, owen))
            assertNull(personOf(owen, wren))
            val seat =
                PartyMember
                    .selectAll()
                    .where {
                        (PartyMember.partyId eq party) and
                            (PartyMember.name eq "Pinewick")
                    }.single()
            assertNull(seat[PartyMember.linkedCharacterId])
        }
    }
}
