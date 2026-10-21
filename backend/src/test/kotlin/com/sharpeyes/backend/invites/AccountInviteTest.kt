package com.sharpeyes.backend.invites

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.AccountInvite
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.parties.PersonRequest
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SavePeopleRequest
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.partiesSeatedIn
import com.sharpeyes.backend.parties.peopleFor
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.activeWorldFor
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A sign-on link, against a real Postgres.
 *
 * The claim under test is an inversion: the sender's "mechobotto runs Kalos with CraneBolton" has
 * to arrive on the recipient's account as "CraneBolton runs Kalos with mechobotto", with the seat
 * that is now theirs bound to a character row and the one that is now somebody else's not. Getting
 * that backwards produces an account that looks entirely plausible and describes the wrong person's
 * parties, which is the failure this repo exists to prevent, so it is pinned here rather than
 * inspected once by hand.
 *
 * The other half is what must NOT travel: loot, clears, and every config the recipient has no seat
 * in.
 */
class AccountInviteTest {
    private val senderId = "user_test_invite_sender"
    private val recipientId = "user_test_invite_recipient"
    private val thirdId = "user_test_invite_third"

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
            val owned =
                Characters
                    .selectAll()
                    .where {
                        (Characters.userId eq senderId) or (Characters.userId eq recipientId) or
                            (Characters.userId eq thirdId)
                    }.map { it[Characters.id] }
            owned.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            // account_invite cascades off both, but the invite's own user_id is the one that keeps
            // a sender's row alive after their person is gone.
            AccountInvite.deleteWhere {
                (AccountInvite.userId eq senderId) or (AccountInvite.userId eq recipientId) or
                    (AccountInvite.userId eq thirdId)
            }
            Party.deleteWhere {
                (Party.userId eq senderId) or (Party.userId eq recipientId) or
                    (Party.userId eq thirdId)
            }
            Person.deleteWhere {
                (Person.userId eq senderId) or (Person.userId eq recipientId) or
                    (Person.userId eq thirdId)
            }
            Characters.deleteWhere {
                (Characters.userId eq senderId) or (Characters.userId eq recipientId) or
                    (Characters.userId eq thirdId)
            }
        }
    }

    @Test
    fun `the recipient takes a seat in the config rather than a copy of it`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            invite("Brock")

            // No copy. This test used to assert one, anchored on the recipient's character: two
            // rows describing one party, each with a pool and a difficulty of its own. See V75.
            assertEquals(emptyList(), partiesOf(recipientId))

            // The roster is unchanged, still the sender's, and the seat that names the recipient's
            // character now points at it.
            assertEquals(listOf("mechobotto", "CraneBolton"), seatNamesOf(source))
            val seat = seatFor(source, "CraneBolton")
            assertEquals(theirCharacter(recipientId, "CraneBolton"), seat[PartyMember.linkedCharacterId])
            // Still not one of the OWNER's, which is what characterId means.
            assertNull(seat[PartyMember.characterId])
            assertNotNull(seatFor(source, "mechobotto")[PartyMember.characterId])
        }
    }

    @Test
    fun `the difficulty, the run time and who loots are the one row's, and the member reads them`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            val request =
                SavePartyRequest(
                    characterId = mine.toString(),
                    bossKey = "kalos-the-guardian",
                    members = listOf("CraneBolton"),
                    shares = mapOf("CraneBolton" to 2),
                    difficulty = "CHAOS",
                    minutes = 12,
                )
            val source = createParty(senderId, mine, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())

            invite("Brock")

            // One row carries the arrangement, and the member reads it there. It used to be copied
            // onto a second row, which is the thing that could then disagree: difficulty is what
            // boss_drop_amount joins on, so two answers to it is two answers to what fell.
            val party = partiesSeatedIn(recipientId).single().party
            assertEquals("CHAOS", party.difficulty)
            assertEquals(12, party.minutes)
            assertEquals(source.toString(), party.id)
            // The shares stay on the one row, where they always were. Nothing was copied, so there is
            // nothing that could come to disagree with them.
            assertEquals(2, seatFor(source, "CraneBolton")[PartyMember.shares])
        }
    }

    @Test
    fun `only the configs the recipient sits in travel`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))
            // Somebody else's party, and a boss the sender runs alone. Neither is the recipient's
            // to receive: one has no seat of theirs, and the other has no seats at all.
            config(mine, "baldrix", listOf("Lynn"))
            solo(mine, "limbo")
            // A night run once, with the recipient in it. Not an arrangement, so not a config to
            // hand over: carrying it would say they run this boss every week on the strength of it.
            // Real data had three of these, and two of them collided with real configs.
            oneOff(mine, "malefic-star", listOf("CraneBolton"))

            val payload = payloadFor("Brock")
            assertEquals(listOf("kalos-the-guardian"), payload.parties.map { it.bossKey })
            // Silently, like the solo and the retired ones: leaving a one-off out is what the link
            // IS, not a config it failed to carry.
            assertEquals(emptyList(), payload.omitted)
        }
    }

    @Test
    fun `a second config on the same boss is named rather than dropped`() {
        transaction {
            val first = addCharacter(senderId, "mechobotto", position = 0)
            val second = addCharacter(senderId, "acmeacme", position = 1)
            attribute("Brock", "CraneBolton")
            config(first, "kalos-the-guardian", listOf("CraneBolton"))
            config(second, "kalos-the-guardian", listOf("CraneBolton"))

            val payload = payloadFor("Brock")

            // One character runs one boss, so the second cannot also become theirs. The count that
            // changed is said, which is the whole difference between this and losing a config.
            assertEquals(1, payload.parties.size)
            assertEquals(1, payload.omitted.size)
            assertEquals("kalos-the-guardian", payload.omitted.single().bossKey)
            assertEquals(OMITTED_DUPLICATE_BOSS, payload.omitted.single().reason)

            val accepted = accept(payload, "Brock")
            assertEquals(1, accepted.partiesCreated)
            assertEquals(1, accepted.omitted.size)
        }
    }

    @Test
    fun `one boss on two of the recipient's characters travels twice, told apart by the seat`() {
        transaction {
            val first = addCharacter(senderId, "mechobotto", position = 0)
            val second = addCharacter(senderId, "acmeacme", position = 1)
            attribute("Brock", "CraneBolton", "Frecklynn")
            config(first, "kalos-the-guardian", listOf("CraneBolton"))
            config(second, "kalos-the-guardian", listOf("Frecklynn"))

            val payload = payloadFor("Brock")

            // The duplicate rule is one boss per CHARACTER, not per person, so both are theirs.
            assertEquals(2, payload.parties.size)
            assertEquals(emptyList(), payload.omitted)

            // And the boss alone cannot tell them apart: same key, same difficulty, one label
            // between them. Whose seat it is is the only thing that differs.
            val bossKeys = payload.parties.map { it.bossKey }
            assertEquals(setOf("kalos-the-guardian"), bossKeys.toSet())
            assertEquals(
                listOf("CraneBolton", "Frecklynn"),
                payload.parties.map { it.ownName }.sorted(),
            )
        }
    }

    @Test
    fun `the landing page names each party by boss and by whose seat it is`() {
        transaction {
            val first = addCharacter(senderId, "mechobotto", position = 0)
            val second = addCharacter(senderId, "acmeacme", position = 1)
            attribute("Brock", "CraneBolton", "Frecklynn")
            config(first, "kalos-the-guardian", listOf("CraneBolton"))
            config(second, "kalos-the-guardian", listOf("Frecklynn"))

            val labels =
                partyLabels(payloadFor("Brock").parties, mapOf("kalos-the-guardian" to "Kalos the Guardian"))

            assertEquals(listOf("Kalos the Guardian", "Kalos the Guardian"), labels.map { it.bossName })
            assertEquals(
                listOf("CraneBolton", "Frecklynn"),
                labels.map { it.characterName }.sorted(),
            )
        }
    }

    @Test
    fun `a boss this build does not know is named by its key rather than dropped`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            // A link made against a newer catalog. The count is what the page leans on, so an
            // unreadable row beats a missing one.
            val labels = partyLabels(payloadFor("Brock").parties, emptyMap())

            assertEquals(listOf("kalos-the-guardian"), labels.map { it.bossName })
            assertEquals(listOf("CraneBolton"), labels.map { it.characterName })
        }
    }

    @Test
    fun `the people list names the sender and whoever else was in the party`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            attribute("Chris", "Lynn")
            // Somebody the sender knows who is in none of the shared configs. The rest of an
            // address book is not part of what one friend hands another.
            attribute("Dwight", "Beetsss")
            config(mine, "kalos-the-guardian", listOf("CraneBolton", "Lynn"))

            invite("Brock")

            val people = peopleOf(recipientId)
            assertEquals(setOf("Jonas", "Chris"), people.keys)
            assertEquals(listOf("mechobotto"), people.getValue("Jonas"))
            assertEquals(listOf("Lynn"), people.getValue("Chris"))
        }
    }

    @Test
    fun `somebody you share no config with still gets you, and still gets linked`() {
        transaction {
            addCharacter(senderId, "mechobotto", position = 0)
            // Named as somebody you run with, but in none of your configs. Found by dry-running
            // this against real data: their account came out with one character and nobody at all,
            // and the link back to the sender had no row on their side to be written onto.
            attribute("Nabla", "Harumi")

            val payload = payloadFor("Nabla")
            assertEquals(listOf("Jonas"), payload.people.map { it.name })
            assertEquals(emptyList(), payload.people.single().characters)
            assertTrue(payload.people.single().isSender)

            invite("Nabla")
            assertEquals(senderId, personRow(recipientId, "Jonas")[Person.linkedUserId])
            assertEquals(recipientId, personRow(senderId, "Nabla")[Person.linkedUserId])
        }
    }

    @Test
    fun `accepting links the two accounts from both ends`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            invite("Brock")

            // The sender's Brock is now an account, and the recipient's copy of the sender is too.
            // Written at the one moment both are known: afterwards the only thing joining them is
            // a character name, which cannot tell a shared party from a coincidence.
            assertEquals(recipientId, personRow(senderId, "Brock")[Person.linkedUserId])
            assertEquals(senderId, personRow(recipientId, "Jonas")[Person.linkedUserId])

            // And the recipient is now IN the sender's config rather than holding a copy of it.
            // One row, one pool: two rows was two pools for one night, and two difficulty columns
            // that could disagree about the mode the piece counts join on. See V75.
            assertEquals(emptyList(), partiesOf(recipientId))
            val seat =
                PartyMember
                    .selectAll()
                    .where { (PartyMember.partyId eq source) and (PartyMember.name eq "CraneBolton") }
                    .single()
            assertEquals(theirCharacter(recipientId, "CraneBolton"), seat[PartyMember.linkedCharacterId])
        }
    }

    @Test
    fun `a third person invited to the same party takes their own seat in it`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            attribute("Chris", "Lynn")
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton", "Lynn"))

            invite("Brock")
            invite("Chris", into = thirdId)

            // All three accounts are in ONE party, because there is only one to be in. Under the
            // mirror this was three rows that had to be kept agreeing with each other.
            val bound =
                PartyMember
                    .selectAll()
                    .where { PartyMember.partyId eq source }
                    .associate { it[PartyMember.name] to it[PartyMember.linkedCharacterId] }
            assertEquals(theirCharacter(recipientId, "CraneBolton"), bound["CraneBolton"])
            assertEquals(theirCharacter(thirdId, "Lynn"), bound["Lynn"])
            // The sender's own seat is theirs, and is never a linked one.
            assertNull(bound["mechobotto"])
        }
    }

    /** The id of [named] on [userId]'s account, which accept has just created. */
    private fun theirCharacter(
        userId: String,
        named: String,
    ): Uuid =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and (Characters.name eq named) }
            .single()[Characters.id]

    @Test
    fun `nothing that happened travels, only what the party is`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))
            BossClear.insert {
                it[characterId] = mine
                it[bossCatalogId] = bossIdForKey("kalos-the-guardian")!!
                it[periodStart] = LocalDate(2026, 8, 27)
                it[cleared] = true
                it[capturedAt] = Clock.System.now()
            }

            invite("Brock")

            // A link describes the party, not the sender's record of what it did. A clear that
            // arrived with it would be this account claiming a kill it has no evidence for.
            val theirCharacters = charactersOf(recipientId)
            val clears =
                BossClear
                    .selectAll()
                    .where { BossClear.characterId eq theirCharacters.getValue("cranebolton") }
                    .count()
            assertEquals(0L, clears)
        }
    }

    @Test
    fun `an account that already holds things can still take a link`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            // A recipient who signed up, looked around and added a character before clicking. This
            // used to be refused, and the refusal only appeared after they pressed the button.
            addCharacter(recipientId, "SomebodyElse", position = 0)
            invite("Brock")

            // Their own character is untouched and the payload's is beside it, appended rather than
            // stacked on position 0.
            val theirs =
                Characters
                    .selectAll()
                    .where { Characters.userId eq recipientId }
                    .associate { it[Characters.name] to it[Characters.position] }
            assertEquals(setOf("SomebodyElse", "CraneBolton"), theirs.keys)
            assertEquals(setOf(0, 1), theirs.values.toSet())
            // And the seat on the SENDER's config is bound to the character just written.
            assertEquals(
                theirCharacter(recipientId, "CraneBolton"),
                seatFor(source, "CraneBolton")[PartyMember.linkedCharacterId],
            )
        }
    }

    @Test
    fun `a character the recipient already has is bound rather than duplicated`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            // They already added the character the link is about. characters has no unique index on
            // (user_id, name), so a second row would insert silently and leave ownCharacterIds
            // picking one of the two arbitrarily.
            val already = addCharacter(recipientId, "CraneBolton", position = 0)
            invite("Brock")

            assertEquals(
                1,
                Characters
                    .selectAll()
                    .where { Characters.userId eq recipientId }
                    .count()
                    .toInt(),
            )
            assertEquals(already, seatFor(source, "CraneBolton")[PartyMember.linkedCharacterId])
        }
    }

    @Test
    fun `a person the recipient already knows is reused, and their own attribution wins`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            // The recipient already knows a Jonas, and has already decided CraneBolton is
            // somebody else's. person has a unique (user_id, name), so reusing is not a nicety.
            savePeople(
                recipientId,
                SavePeopleRequest(
                    listOf(
                        PersonRequest(null, "Jonas", emptyList()),
                        PersonRequest(null, "Dwight", listOf("CraneBolton")),
                    ),
                ),
                Clock.System.now(),
            )
            invite("Brock")

            val people = peopleFor(recipientId).associate { it.name to it.characters }
            assertEquals(setOf("Jonas", "Dwight"), people.keys)
            // CraneBolton is NOT moved onto Jonas. Their address book is theirs, and choosing
            // between two people's answers about a third is the guess this refuses to make.
            assertEquals(listOf("CraneBolton"), people["Dwight"])
            // The Jonas they already knew gains what the link does say: which character the
            // sender plays. Reused, not inserted again, person being unique on (user_id, name).
            assertEquals(listOf("mechobotto"), people["Jonas"])
        }
    }

    @Test
    fun `a world the recipient already chose is not overruled by a link`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            ensureUser(recipientId, "$recipientId@example.com")
            setActiveWorld(recipientId, WORLD_HEROIC)
            invite("Brock")

            // Somebody else's link does not move which world your whole site answers for. The
            // toggle is one click if the party is in the other one.
            assertEquals(WORLD_HEROIC, activeWorldFor(recipientId))
        }
    }

    @Test
    fun `a character a link created is one nothing has asked Nexon about`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))
            invite("Brock")

            // A payload names the recipient's characters and nothing else about them: the sender
            // has no row for somebody else's character, only seats naming one. So the level and job
            // come from a lookup, and a null sprite_checked_at is what both the accept route and
            // the daily job find them by.
            assertEquals(listOf("CraneBolton"), unaskedCharacters(recipientId).map { it.name })
        }
    }

    @Test
    fun `a link is sent under your main character's name, and is never asked for`() {
        transaction {
            addCharacter(senderId, "mechobotto", position = 0)
            val main = addCharacter(senderId, "acmeacme", position = 1)

            // No main set yet, so the first in the carousel is the closest thing to one.
            assertEquals("mechobotto", senderNameFor(senderId))

            Users.update({ Users.id eq senderId }) { it[mainCharacterId] = main }
            assertEquals("acmeacme", senderNameFor(senderId))

            // Nothing to send one as. That account has no people to invite either, so the route
            // refusing is the whole of what this has to do.
            assertNull(senderNameFor(recipientId))
        }
    }

    @Test
    fun `the token is never stored, only what it hashes to`() {
        val token = newInviteToken()
        val other = newInviteToken()

        assertEquals(hashInviteToken(token), hashInviteToken(token))
        assertFalse(hashInviteToken(token) == hashInviteToken(other))
        // A dump of account_invite grants nobody anything, which is the only reason the preview
        // behind a token can be unauthenticated.
        assertFalse(hashInviteToken(token).contains(token))
    }

    @Test
    fun `a sender who has not chosen a world has no link to give`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            config(mine, "kalos-the-guardian", listOf("CraneBolton"))
            val personId = personRow(senderId, "Brock")[Person.id]
            assertNotNull(buildInvitePayload(senderId, personId, "Jonas"))

            // Every config the link would carry was read through the sender's world. Without one
            // there is nothing to read them through, and a link built anyway would hand over an
            // arrangement its sender was never shown. See V74.
            Users.update({ Users.id eq senderId }) { it[worldType] = null }
            assertNull(buildInvitePayload(senderId, personId, "Jonas"))
        }
    }

    // Helpers. Each writes the sender's side of one fact, so the tests above read as the claim
    // they make rather than as setup.

    private fun addCharacter(
        userId: String,
        name: String,
        position: Int,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        // A character is inserted here directly, so the account has to say which world it is
        // looking at. buildInvitePayload refuses for a sender with no world, every config it would
        // read being narrowed by one: see V74 and users/WorldType.kt. The RECIPIENT keeps none,
        // deliberately, because accepting is what gives them one (InviteAccept sets it from the
        // payload) and that is the behaviour these tests are here to hold.
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[Characters.position] = position
        }
        return id
    }

    /** Says whose some characters are, keeping every person already named. */
    private fun attribute(
        person: String,
        vararg characters: String,
    ) {
        val existing =
            peopleOf(senderId).map { (name, characters) ->
                PersonRequest(
                    id = personRow(senderId, name)[Person.id].toString(),
                    name = name,
                    characters = characters,
                )
            }
        savePeople(
            senderId,
            SavePeopleRequest(existing + PersonRequest(name = person, characters = characters.toList())),
            Clock.System.now(),
        )
    }

    private fun config(
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
    ): Uuid =
        createParty(
            userId = senderId,
            characterId = characterId,
            bossCatalogId = bossIdForKey(bossKey)!!,
            request = SavePartyRequest(characterId.toString(), bossKey, members),
            now = Clock.System.now(),
        )

    /** A boss run once, armed for the period it was made in. See V32. */
    private fun oneOff(
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
    ) {
        val request = SavePartyRequest(characterId.toString(), bossKey, members, oneOff = true)
        createParty(senderId, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now())
    }

    private fun solo(
        characterId: Uuid,
        bossKey: String,
    ) {
        val id = config(characterId, bossKey, emptyList())
        Party.update({ Party.id eq id }) { it[Party.solo] = true }
    }

    private fun payloadFor(person: String): InvitePayload =
        buildInvitePayload(senderId, personRow(senderId, person)[Person.id], senderName = "Jonas")!!

    /**
     * Makes a link for [person] and redeems it into an empty account.
     *
     * The person is named again rather than read out of the payload: the payload does not carry
     * the recipient, only what they are being given, and taking the first name in it would accept
     * one person's link on behalf of another.
     */
    private fun invite(
        person: String,
        into: String = recipientId,
    ): AcceptedInvite {
        ensureUser(into, "$into@example.com")
        val personId = personRow(senderId, person)[Person.id]
        return acceptInvite(
            buildInvitePayload(senderId, personId, "Jonas")!!,
            into,
            null,
            personId,
            Clock.System.now(),
        )
    }

    private fun accept(
        payload: InvitePayload,
        person: String,
        into: String = recipientId,
    ): AcceptedInvite {
        ensureUser(into, "$into@example.com")
        return acceptInvite(payload, into, null, personRow(senderId, person)[Person.id], Clock.System.now())
    }

    private fun personRow(
        userId: String,
        name: String,
    ) = Person
        .selectAll()
        .where { (Person.userId eq userId) and (Person.name eq name) }
        .single()

    private fun peopleOf(userId: String): Map<String, List<String>> {
        val characters =
            PersonCharacter
                .selectAll()
                .where { PersonCharacter.userId eq userId }
                .orderBy(PersonCharacter.name)
                .groupBy({ it[PersonCharacter.personId] }) { it[PersonCharacter.name] }
        return Person
            .selectAll()
            .where { Person.userId eq userId }
            .associate { it[Person.name] to characters[it[Person.id]].orEmpty() }
    }

    private fun charactersOf(userId: String): Map<String, Uuid> =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .associate { it[Characters.name].lowercase() to it[Characters.id] }

    private fun partiesOf(userId: String) =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .toList()

    private fun seatNamesOf(partyId: Uuid): List<String> =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .orderBy(PartyMember.position)
            .map { it[PartyMember.name] }

    private fun seatFor(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .single()

    @Test
    fun `a character the recipient did not confirm is not taken, and seats no one`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            // One person with two characters, so attribute() is not the helper: that one appends a
            // new person each call and person is unique on (user_id, name).
            savePeople(
                senderId,
                SavePeopleRequest(
                    listOf(PersonRequest(null, "Brock", listOf("CraneBolton", "NotActuallyTheirs"))),
                ),
                Clock.System.now(),
            )
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton", "NotActuallyTheirs"))

            // They tick one of the two. The sender was wrong about the other, which is the whole
            // reason to ask: these names are the SENDER's spelling of somebody else's characters.
            ensureUser(recipientId, "$recipientId@example.com")
            val personId = personRow(senderId, "Brock")[Person.id]
            acceptInvite(
                buildInvitePayload(senderId, personId, "Jonas")!!,
                recipientId,
                listOf("CraneBolton"),
                personId,
                Clock.System.now(),
            )

            assertEquals(
                listOf("CraneBolton"),
                Characters
                    .selectAll()
                    .where { Characters.userId eq recipientId }
                    .map { it[Characters.name] },
            )
            // And the seat they did not claim stays unbound, so it gets them nothing: an unclaimed
            // seat is not a party they are in.
            assertNotNull(seatFor(source, "CraneBolton")[PartyMember.linkedCharacterId])
            assertNull(seatFor(source, "NotActuallyTheirs")[PartyMember.linkedCharacterId])
        }
    }

    @Test
    fun `confirming everything is the same as not being asked`() {
        transaction {
            val mine = addCharacter(senderId, "mechobotto", position = 0)
            attribute("Brock", "CraneBolton")
            val source = config(mine, "kalos-the-guardian", listOf("CraneBolton"))

            ensureUser(recipientId, "$recipientId@example.com")
            val personId = personRow(senderId, "Brock")[Person.id]
            acceptInvite(
                buildInvitePayload(senderId, personId, "Jonas")!!,
                recipientId,
                // Their own spelling, which need not match the sender's: names are matched the way
                // every other character name in this app is.
                listOf("cranebolton"),
                personId,
                Clock.System.now(),
            )

            assertNotNull(seatFor(source, "CraneBolton")[PartyMember.linkedCharacterId])
        }
    }
}
