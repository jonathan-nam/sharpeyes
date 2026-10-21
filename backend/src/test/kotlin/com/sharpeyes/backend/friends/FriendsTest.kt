package com.sharpeyes.backend.friends

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.DiscordUsername
import com.sharpeyes.backend.db.FriendRequest
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notificationsFor
import com.sharpeyes.backend.parties.PersonRequest
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SavePeopleRequest
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
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
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

class FriendsTest {
    private val jonas = "user_test_friends_jonas"
    private val brock = "user_test_friends_brock"
    private val everyone = listOf(jonas, brock)

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
            Party.deleteWhere { Party.userId inList everyone }
            Person.deleteWhere { Person.userId inList everyone }
            Characters.deleteWhere { Characters.userId inList everyone }
            DiscordUsername.deleteWhere { DiscordUsername.discordId inList everyone.map { "discord-$it" } }
            exec("""DELETE FROM auth_user WHERE id IN ('$jonas', '$brock')""")
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
            val (warrior) = discordAccount(jonas, "jonasb", "warden2030")
            val (crane) = discordAccount(brock, "brockdiscord", "CraneBolton")
            savePeople(
                jonas,
                SavePeopleRequest(listOf(PersonRequest(null, "Brock", listOf("CraneBolton")))),
                Clock.System.now(),
            )
            val request = SavePartyRequest(warrior.toString(), "kalos-the-guardian", listOf("CraneBolton"))
            val party = createParty(jonas, warrior, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())

            assertEquals(SendOutcome.Sent, sendFriendRequest(jonas, " @BrockDiscord ", Clock.System.now()))
            val asked = notificationsFor(brock).notifications.single()
            assertEquals(NotificationKind.FRIEND_REQUEST, asked.kind)
            assertEquals("jonasb", asked.actor?.username)
            assertEquals("warden2030", asked.actor?.name)
            assertEquals(1, notificationsFor(brock).unread)

            acceptFriendRequest(brock, Uuid.parse(asked.subjectId!!), Clock.System.now())

            assertEquals("Brock", personOf(jonas, brock))
            assertEquals("warden2030", personOf(brock, jonas))
            val seat =
                PartyMember
                    .selectAll()
                    .where {
                        (PartyMember.partyId eq party) and
                            (PartyMember.name eq "CraneBolton")
                    }.single()
            assertEquals(crane, seat[PartyMember.linkedCharacterId])
            assertEquals(listOf("Brock"), socialFor(jonas).friends.map { it.name })
            // The request is answered, so it is off Brock's bell, and Jonas hears it was accepted.
            assertEquals(emptyList(), notificationsFor(brock).notifications)
            assertEquals(
                listOf(NotificationKind.FRIEND_ACCEPTED),
                notificationsFor(jonas).notifications.map { it.kind },
            )
        }
    }

    @Test
    fun `asking somebody who already asked you accepts them`() {
        transaction {
            discordAccount(jonas, "jonasb", "warden2030")
            discordAccount(brock, "brockdiscord", "CraneBolton")
            sendFriendRequest(jonas, "brockdiscord", Clock.System.now())

            assertEquals(SendOutcome.Accepted, sendFriendRequest(brock, "jonasb", Clock.System.now()))
            assertEquals(SendOutcome.AlreadyFriends, sendFriendRequest(jonas, "brockdiscord", Clock.System.now()))
            assertEquals("CraneBolton", personOf(jonas, brock))
        }
    }

    @Test
    fun `declining or cancelling clears the notification, and asking twice notifies once`() {
        transaction {
            discordAccount(jonas, "jonasb", "warden2030")
            discordAccount(brock, "brockdiscord", "CraneBolton")
            sendFriendRequest(jonas, "brockdiscord", Clock.System.now())
            sendFriendRequest(jonas, "brockdiscord", Clock.System.now())
            val asked = notificationsFor(brock).notifications.single()

            dropFriendRequest(jonas, Uuid.parse(asked.subjectId!!))

            assertEquals(emptyList(), notificationsFor(brock).notifications)
        }
    }

    @Test
    fun `nobody, or yourself, is refused`() {
        transaction {
            discordAccount(jonas, "jonasb", "warden2030")

            assertEquals(SendOutcome.Unknown, sendFriendRequest(jonas, "nobody-by-this-name", Clock.System.now()))
            assertEquals(SendOutcome.Yourself, sendFriendRequest(jonas, "JonasB", Clock.System.now()))
        }
    }

    @Test
    fun `removing a friend unlinks both sides and takes the seats back`() {
        transaction {
            val (warrior) = discordAccount(jonas, "jonasb", "warden2030")
            discordAccount(brock, "brockdiscord", "CraneBolton")
            val request = SavePartyRequest(warrior.toString(), "kalos-the-guardian", listOf("CraneBolton"))
            val party = createParty(jonas, warrior, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
            sendFriendRequest(jonas, "brockdiscord", Clock.System.now())
            sendFriendRequest(brock, "jonasb", Clock.System.now())
            val friend = socialFor(brock).friends.single()

            removeFriend(brock, Uuid.parse(friend.id))

            assertNull(personOf(jonas, brock))
            assertNull(personOf(brock, jonas))
            val seat =
                PartyMember
                    .selectAll()
                    .where {
                        (PartyMember.partyId eq party) and
                            (PartyMember.name eq "CraneBolton")
                    }.single()
            assertNull(seat[PartyMember.linkedCharacterId])
        }
    }
}
