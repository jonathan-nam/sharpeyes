package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.currentBossClearsFor
import com.sharpeyes.backend.bosses.upsertBossClears
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.plugins.Refusal
import com.sharpeyes.backend.services.DetectedBossClear
import com.sharpeyes.backend.sprites.spriteProxyPath
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Party configs, against a real Postgres.
 *
 * A config is one of your characters, on one boss, with the people that character runs it with:
 * "tidelark runs Kalos with Pinewick". The claims worth a database to check are the ones
 * about identity, since getting them wrong is invisible: that your own character is stored as a
 * seat (a loot payout points at seats, and you are usually the seller), that a seat survives the
 * roster being reordered, that a person is attached to a CHARACTER rather than to a seat, and that
 * one character cannot have two configs for the same boss.
 */
class PartyConfigTest {
    private val userOneId = "user_test_config_1"
    private val userTwoId = "user_test_config_2"

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
            // boss_clear and screenshots reference the characters, so they go before them.
            val owned =
                Characters
                    .selectAll()
                    .where { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
                    .map { it[Characters.id] }
            owned.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            Screenshots.deleteWhere { (Screenshots.userId eq userOneId) or (Screenshots.userId eq userTwoId) }
            Party.deleteWhere { (Party.userId eq userOneId) or (Party.userId eq userTwoId) }
            Person.deleteWhere { (Person.userId eq userOneId) or (Person.userId eq userTwoId) }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
        sprite: String? = null,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        // A character is inserted here directly, so the account has to say which world it is
        // looking at or every account-wide read below is empty. The route refuses to create a
        // character without one at all: see V74 and users/WorldType.kt.
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[spriteImgUrl] = sprite
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun config(
        userId: String,
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
        difficulty: String? = null,
        minutes: Int? = null,
    ): PartyResponse {
        val request =
            SavePartyRequest(characterId.toString(), bossKey, members, difficulty = difficulty, minutes = minutes)
        val id = createParty(userId, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now())
        return findParty(id, userId)!!
    }

    @Test
    fun `a config is your character on one boss, and stores you as the first seat`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark", sprite = "https://nexon.example/kip.png")
            val party = config(userOneId, mine, "kalos-the-guardian", listOf("Pinewick"))

            assertEquals("kalos-the-guardian", party.bossKey)
            assertEquals(mine.toString(), party.characterId)
            // You first, then the people you run it with. You are a seat because a loot payout
            // points at seats and you are usually the one who sold the drop.
            assertEquals(listOf("tidelark", "Pinewick"), party.members.map { it.name })
            assertEquals(mine.toString(), party.members[0].characterId)
            // The seat is drawn from our own proxy path, not Nexon's URL, which is what stops a
            // roster refetching every sprite on every page load. See spriteProxyPath.
            assertEquals(spriteProxyPath("https://nexon.example/kip.png"), party.members[0].spriteImgUrl)
            assertNull(party.members[1].characterId)
        }
    }

    @Test
    fun `whose character a member is comes from the people list, by name`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            savePeople(
                userOneId,
                SavePeopleRequest(listOf(PersonRequest(name = "Chris", characters = listOf("Pinewick")))),
                Clock.System.now(),
            )
            val kalos = config(userOneId, mine, "kalos-the-guardian", listOf("Pinewick"))
            val baldrix = config(userOneId, mine, "baldrix", listOf("Pinewick"))

            // Said once, shown everywhere that character appears. Storing the person on the seat
            // would mean saying it again per config, and the copies would drift.
            assertEquals("Chris", kalos.members[1].personName)
            assertEquals("Chris", baldrix.members[1].personName)
            assertEquals(kalos.members[1].personId, baldrix.members[1].personId)
        }
    }

    @Test
    fun `a seat survives the roster being reordered, so a payout still points at somebody`() {
        transaction {
            val mine = addCharacter(userOneId, "orchid88")
            val party = config(userOneId, mine, "malefic-star", listOf("Lynn", "Kaiser"))
            val lynn = party.members.first { it.name == "Lynn" }

            val request = SavePartyRequest(mine.toString(), "malefic-star", listOf("Kaiser", "Lynn"))
            saveParty(userOneId, Uuid.parse(party.id), request, Clock.System.now())

            val saved = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(listOf("orchid88", "Kaiser", "Lynn"), saved.members.map { it.name })
            assertEquals(lynn.id, saved.members.first { it.name == "Lynn" }.id)
        }
    }

    @Test
    fun `editing a config leaves the day it was set up alone`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val party = config(userOneId, mine, "limbo", listOf("Lynn"))

            val swapped = SavePartyRequest(mine.toString(), "limbo", listOf("Kaiser"))
            saveParty(userOneId, Uuid.parse(party.id), swapped, Clock.System.now())
            val saved = findParty(Uuid.parse(party.id), userOneId)!!

            // Party View decides which configs a PAST week admits by comparing createdAt against
            // that week's end (see existedInWeek in frontend/lib/parties.ts). If an edit moved
            // createdAt forward, swapping a name today would evict the config from weeks it really
            // was around for, and a week that was right yesterday would quietly lose rows.
            assertEquals(party.createdAt, saved.createdAt)
            assertTrue(saved.updatedAt >= party.updatedAt)
            assertEquals(listOf("tidelark", "Kaiser"), saved.members.map { it.name })
        }
    }

    @Test
    fun `a config cannot be moved to another character or boss, so a past clear cannot be reattributed`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val other = addCharacter(userOneId, "orchid88")
            val party = config(userOneId, mine, "limbo", listOf("Lynn"))

            // Asks for both to be changed. The character and the boss are what the config IS, and
            // boss_clear is keyed on exactly that pair, so honouring this would move every past
            // clear this config draws onto a character who never ran it.
            saveParty(
                userOneId,
                Uuid.parse(party.id),
                SavePartyRequest(other.toString(), "kalos-the-guardian", listOf("Lynn")),
                Clock.System.now(),
            )

            val saved = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(mine.toString(), saved.characterId)
            assertEquals("limbo", saved.bossKey)
        }
    }

    @Test
    fun `a config says which difficulty it runs, and can change its mind`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val party = config(userOneId, mine, "kalos-the-guardian", listOf("Pinewick"), difficulty = "CHAOS")
            assertEquals("CHAOS", party.difficulty)

            // Editable, unlike the character and the boss: a party that starts clearing Extreme is
            // the same party, with the same pool.
            saveParty(
                userOneId,
                Uuid.parse(party.id),
                SavePartyRequest(mine.toString(), "kalos-the-guardian", listOf("Pinewick"), difficulty = "EXTREME"),
                Clock.System.now(),
            )
            assertEquals("EXTREME", findParty(Uuid.parse(party.id), userOneId)!!.difficulty)
        }
    }

    @Test
    fun `a config that has not said which difficulty it runs is not given one`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            // Null, not NORMAL. Every config predating the column is in this state, and defaulting
            // it would put a mode on screen that nobody chose.
            assertNull(config(userOneId, mine, "limbo", listOf("Lynn")).difficulty)
        }
    }

    @Test
    fun `a config says how long it takes, and can be re-timed`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val party = config(userOneId, mine, "lucid", listOf("Pinewick"), minutes = 20)
            assertEquals(20, party.minutes)

            saveParty(
                userOneId,
                Uuid.parse(party.id),
                SavePartyRequest(mine.toString(), "lucid", listOf("Pinewick"), minutes = 12),
                Clock.System.now(),
            )
            assertEquals(12, findParty(Uuid.parse(party.id), userOneId)!!.minutes)
        }
    }

    @Test
    fun `a config nobody has timed is not given a time`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            // Null, not thirty. The flat estimate is Run Order's fallback and is marked there as
            // one; storing it here would turn a guess into something that reads as measured.
            assertNull(config(userOneId, mine, "limbo", listOf("Lynn")).minutes)
        }
    }

    @Test
    fun `the same boss on two characters can be timed differently`() {
        transaction {
            // Why the time is on the config and not the boss: one character walks Lucid and
            // another takes twenty minutes over it, and both are true at once.
            val fast = addCharacter(userOneId, "tidelark")
            val slow = addCharacter(userOneId, "runebae")
            assertEquals(5, config(userOneId, fast, "lucid", listOf("Lynn"), minutes = 5).minutes)
            assertEquals(20, config(userOneId, slow, "lucid", listOf("Mirelle"), minutes = 20).minutes)
        }
    }

    @Test
    fun `refuses a run time it cannot store, rather than clamping it`() {
        // Zero is a real answer: a boss walked through in under a minute. Rounding it up would be
        // the app disagreeing with the person who timed it.
        assertNull(validateMinutes(0))
        assertNull(validateMinutes(null))
        assertNull(validateMinutes(MAX_RUN_MINUTES))
        assertEquals("minutes cannot be negative", validateMinutes(-1))
        // Clamped to 600, a typo'd 3000 would order somebody's night by a number they never typed.
        assertEquals("minutes must be at most 600", validateMinutes(MAX_RUN_MINUTES + 1))
    }

    @Test
    fun `refuses a difficulty the boss does not have, rather than storing it`() {
        transaction {
            fun check(
                bossKey: String,
                difficulty: String?,
            ) = validateDifficulty(bossIdForKey(bossKey)!!, difficulty)

            // Kalos is a monster, so its third rung is Chaos and there is no Hard Kalos to enter.
            assertEquals(
                "difficulty must be one of: EASY, NORMAL, CHAOS, EXTREME",
                check("kalos-the-guardian", "HARD"),
            )
            // Baldrix is not a monster, so it is the other way round.
            assertEquals("difficulty must be one of: NORMAL, HARD", check("baldrix", "CHAOS"))
            // The Black Mage is fought at two, and neither of them is Normal.
            assertEquals("difficulty must be one of: HARD, EXTREME", check("black-mage", "NORMAL"))
            assertNull(check("black-mage", "EXTREME"))
            // Saying nothing is allowed, and is what an untouched config says.
            assertNull(check("kalos-the-guardian", null))
        }
    }

    @Test
    fun `refuses a config that cannot be created as asked`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val theirs = addCharacter(userTwoId, "SomebodyElse")
            val kalos = bossIdForKey("kalos-the-guardian")

            fun check(
                characterId: Uuid?,
                bossKey: String,
                members: List<String>,
            ) = validateNewParty(
                SavePartyRequest(characterId?.toString() ?: "", bossKey, members),
                userOneId,
                characterId,
                bossIdForKey(bossKey),
                Clock.System.now(),
            )

            assertEquals(
                "characterId must be one of your characters",
                check(theirs, "kalos-the-guardian", listOf("X")),
            )
            // Zakum is in catalog/bosses.yaml but untracked, so it is seeded into no table.
            assertEquals("unknown bossKey", check(mine, "zakum", listOf("X")))
            // A boss your character solos has no config at all, which is why solo runs never show.
            assertEquals(
                Refusal("This party has nobody else in it. Add a member."),
                check(mine, "kalos-the-guardian", emptyList()),
            )
            assertEquals(
                Refusal("Parties hold up to 6. Remove a member."),
                check(mine, "kalos-the-guardian", (1..6).map { "M$it" }),
            )
            assertEquals(
                Refusal("A character is listed twice. Remove one."),
                check(mine, "kalos-the-guardian", listOf("Lynn", "lynn")),
            )
            assertNull(check(mine, "kalos-the-guardian", listOf("Pinewick")))

            // And a second config for the same character and boss is two answers to one question.
            config(userOneId, mine, "kalos-the-guardian", listOf("Pinewick"))
            assertEquals(
                "that character already has a party for this boss",
                validateNewParty(
                    SavePartyRequest(mine.toString(), "kalos-the-guardian", listOf("Other")),
                    userOneId,
                    mine,
                    kalos,
                    Clock.System.now(),
                ),
            )
        }
    }

    @Test
    fun `two of your characters can run the same boss with different people`() {
        transaction {
            val kip = addCharacter(userOneId, "tidelark")
            val warrior = addCharacter(userOneId, "orchid88")
            config(userOneId, kip, "limbo", listOf("Pinewick"))
            config(userOneId, warrior, "limbo", listOf("Lynn", "Kaiser"))

            // Five "Limbo carry" rows in a hand-kept sheet are five characters of yours running
            // Limbo, not five configs for one of them.
            val parties = partiesFor(userOneId).filter { it.bossKey == "limbo" }
            assertEquals(2, parties.size)
            assertEquals(setOf(kip.toString(), warrior.toString()), parties.map { it.characterId }.toSet())
        }
    }

    @Test
    fun `refuses a second config that puts the same character on the same boss`() {
        transaction {
            val kip = addCharacter(userOneId, "tidelark")
            val warrior = addCharacter(userOneId, "orchid88")
            val limbo = bossIdForKey("limbo")!!
            config(userOneId, kip, "limbo", listOf("Pinewick", "Moxie77Q"))

            fun check(members: List<String>) =
                validateBossRoster(
                    userOneId,
                    limbo,
                    exclude = null,
                    rosterOf(warrior, members),
                    Clock.System.now(),
                    oneOff = false,
                )

            // A character clears a boss once a week, so lending Moxie77Q to a second Limbo party
            // states a night that cannot happen. Refused where it is written, not dropped later.
            assertEquals(
                Refusal("Moxie77Q is already in tidelark's party for this boss. Remove them from it first."),
                check(listOf("Lynn", "Moxie77Q")),
            )
            // Case and padding are typing, not identity, the same as validateMembers.
            assertEquals(
                Refusal("Moxie77Q is already in tidelark's party for this boss. Remove them from it first."),
                check(listOf(" moxie77q ")),
            )
            // The owner of the other config holds its slot too, from either end.
            assertEquals(
                Refusal("tidelark is already in tidelark's party for this boss. Remove them from it first."),
                check(listOf("tidelark")),
            )
            // Different people is still the whole point: this is what a second character is for.
            assertNull(check(listOf("Lynn", "Kaiser")))
            // Another boss is another clear.
            val lotus = bossIdForKey("lotus")!!
            assertNull(
                validateBossRoster(
                    userOneId,
                    lotus,
                    null,
                    rosterOf(warrior, listOf("Moxie77Q")),
                    Clock.System.now(),
                    oneOff = false,
                ),
            )
            // And another account's configs are not competition.
            assertNull(
                validateBossRoster(userTwoId, limbo, null, listOf("Moxie77Q"), Clock.System.now(), oneOff = false),
            )
        }
    }

    @Test
    fun `a seat somebody has left does not hold their slot on that boss`() {
        transaction {
            val warrior = addCharacter(userOneId, "orchid88")
            val kip = addCharacter(userOneId, "tidelark")
            val kalos = bossIdForKey("kalos-the-guardian")!!
            val party = config(userOneId, warrior, "kalos-the-guardian", listOf("Quessa", "Moxie77Q"))

            // Quessa leaves that party. The seat is RETIRED rather than deleted, because a
            // payout or a past week can point at it, and it drops out of the roster the page draws.
            PartyMember.update({
                (PartyMember.partyId eq Uuid.parse(party.id)) and (PartyMember.name eq "Quessa")
            }) { it[standing] = false }

            // So she is free to run the boss with somebody else. Counting the retired seat refused
            // this, naming a config the user could look straight at and not find her in.
            assertNull(
                validateBossRoster(
                    userOneId,
                    kalos,
                    null,
                    rosterOf(kip, listOf("Quessa")),
                    Clock.System.now(),
                    oneOff = false,
                ),
            )

            // Somebody still in that roster is still competition, which is the rule's whole point.
            assertEquals(
                Refusal("Moxie77Q is already in orchid88's party for this boss. Remove them from it first."),
                validateBossRoster(
                    userOneId,
                    kalos,
                    null,
                    rosterOf(kip, listOf("Moxie77Q")),
                    Clock.System.now(),
                    oneOff = false,
                ),
            )
        }
    }

    @Test
    fun `a config is not competition with itself when it is edited`() {
        transaction {
            val kip = addCharacter(userOneId, "tidelark")
            val limbo = bossIdForKey("limbo")!!
            val party = config(userOneId, kip, "limbo", listOf("Pinewick"))

            // Re-saving the same roster would otherwise trip over the seats it already owns, which
            // would make every config holding a member uneditable.
            assertNull(
                validateBossRoster(
                    userOneId,
                    limbo,
                    exclude = Uuid.parse(party.id),
                    rosterOf(kip, listOf("Pinewick")),
                    Clock.System.now(),
                    oneOff = false,
                ),
            )
        }
    }

    @Test
    fun `a week can lend somebody the party they were dropped from`() {
        transaction {
            val kip = addCharacter(userOneId, "tidelark")
            val warrior = addCharacter(userOneId, "orchid88")
            val limbo = bossIdForKey("limbo")!!
            val lender = config(userOneId, kip, "limbo", listOf("Pinewick"))
            val borrower = config(userOneId, warrior, "limbo", listOf("Lynn"))
            val week = currentWeek()

            fun check(members: List<String>) =
                validateWeekRoster(
                    userOneId,
                    limbo,
                    exclude = Uuid.parse(borrower.id),
                    week,
                    rosterOf(warrior, members),
                )

            // While Pine is in the other party's week, they are holding its Limbo clear.
            assertEquals(
                Refusal("Pinewick already ran this boss this week. Remove them from this week."),
                check(listOf("Lynn", "Pinewick")),
            )

            // Dropped from that week, Pine's clear is free, so the other party can have them. The
            // standing rosters have not moved, which is why this reads through rostersFor.
            saveWeekRoster(
                Uuid.parse(lender.id),
                kip,
                week,
                listOf<String>(),
                SeatContext(userOneId, emptyMap(), Clock.System.now()),
            )
            assertNull(check(listOf("Lynn", "Pinewick")))
        }
    }

    @Test
    fun `a week the party was taken off is a week its members were free`() {
        transaction {
            val kip = addCharacter(userOneId, "tidelark")
            val warrior = addCharacter(userOneId, "orchid88")
            val limbo = bossIdForKey("limbo")!!
            val lender = config(userOneId, kip, "limbo", listOf("Pinewick"))
            val borrower = config(userOneId, warrior, "limbo", listOf("Lynn"))
            val week = currentWeek()

            fun check() =
                validateWeekRoster(
                    userOneId,
                    limbo,
                    exclude = Uuid.parse(borrower.id),
                    week,
                    rosterOf(warrior, listOf("Lynn", "Pinewick")),
                )

            assertEquals(Refusal("Pinewick already ran this boss this week. Remove them from this week."), check())

            // The party did not run this week at all, so nothing in it ran the boss and Pine's
            // clear is free. The config is untouched and holds him again next week.
            setRunsInPeriod(Uuid.parse(lender.id), oneOff = false, week, runs = false, now = Clock.System.now())
            assertNull(check())
        }
    }

    @Test
    fun `refuses a people list that claims one character for two people`() {
        transaction {
            ensureUser(userOneId, "$userOneId@example.com")
            val clash =
                SavePeopleRequest(
                    listOf(
                        PersonRequest(name = "Chris", characters = listOf("Pinewick")),
                        PersonRequest(name = "Felix", characters = listOf("pinewick")),
                    ),
                )
            // Character names are unique in a world, so two owners is a mistake, and letting it
            // through makes "whose is this?" a question with two answers.
            assertEquals(Refusal("Two people share a character. Remove it from one."), validatePeople(clash))
            assertEquals(
                Refusal("Two people share a name. Rename one."),
                validatePeople(SavePeopleRequest(listOf(PersonRequest(name = "Chris"), PersonRequest(name = "chris")))),
            )
        }
    }

    @Test
    fun `removing a person leaves the configs that named their characters alone`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            savePeople(
                userOneId,
                SavePeopleRequest(listOf(PersonRequest(name = "Chris", characters = listOf("Pinewick")))),
                Clock.System.now(),
            )
            val party = config(userOneId, mine, "baldrix", listOf("Pinewick"))
            assertEquals("Chris", party.members[1].personName)

            savePeople(userOneId, SavePeopleRequest(emptyList()), Clock.System.now())

            val after = findParty(Uuid.parse(party.id), userOneId)!!
            // The seat is untouched: the people list says whose a character is, and taking that
            // back is not the same as saying the character was not there.
            assertEquals("Pinewick", after.members[1].name)
            assertNull(after.members[1].personName)
            assertTrue(peopleFor(userOneId).isEmpty())
        }
    }

    @Test
    fun `a config and the clear matrix are the same row, read from both ends`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val party = config(userOneId, mine, "kalos-the-guardian", listOf("Pinewick"))
            // Nobody has said anything this period, which is not the same as "not cleared".
            assertNull(party.cleared)

            val boss =
                BossCatalog
                    .selectAll()
                    .where { BossCatalog.bossKey eq "kalos-the-guardian" }
                    .first()
            setPartyClear(party, boss[BossCatalog.id], boss[BossCatalog.reset], true, Clock.System.now())

            val ticked = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(true, ticked.cleared)
            // No screenshot behind it, so the UI can say it was ticked rather than captured.
            assertTrue(ticked.clearedByHand)

            // And the clear matrix sees the same thing, because it IS the same row. This is the
            // whole of the sync between the two pages: one answer, two readers.
            val matrix = currentBossClearsFor(userOneId, Clock.System.now())
            val clears = matrix[mine.toString()].orEmpty()
            assertEquals(listOf("kalos-the-guardian"), clears.map { it.bossKey })
            assertTrue(clears.single().cleared)

            // Un-ticking says "seen, not done" rather than removing the row: absent would mean
            // nobody had said anything, and somebody just did.
            setPartyClear(party, boss[BossCatalog.id], boss[BossCatalog.reset], false, Clock.System.now())
            assertEquals(false, findParty(Uuid.parse(party.id), userOneId)!!.cleared)
        }
    }

    @Test
    fun `a planner capture shows up in the party view without being told twice`() {
        transaction {
            val mine = addCharacter(userOneId, "tidelark")
            val party = config(userOneId, mine, "limbo", listOf("Pinewick"))
            val shot = Uuid.random()
            Screenshots.insert {
                it[Screenshots.id] = shot
                it[Screenshots.userId] = userOneId
                it[characterId] = mine
                it[type] = "PLANNER"
                it[uploadedAt] = Clock.System.now()
                it[parseStatus] = "SUCCESS"
            }
            upsertBossClears(
                mine,
                listOf(DetectedBossClear("limbo", true)),
                shot,
                Clock.System.now(),
            )

            val seen = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(true, seen.cleared)
            // Read off a planner, so not by hand: the two are not equally trustworthy and are not
            // drawn the same.
            assertTrue(!seen.clearedByHand)
        }
    }

    @Test
    fun `another account's configs are neither listed nor readable`() {
        transaction {
            val theirs = addCharacter(userTwoId, "TheirGuy")
            val party = config(userTwoId, theirs, "limbo", listOf("Someone"))
            ensureUser(userOneId, "$userOneId@example.com")

            assertTrue(partiesFor(userOneId).isEmpty())
            assertNull(findParty(Uuid.parse(party.id), userOneId))
            assertTrue(!ownsParty(Uuid.parse(party.id), userOneId))
            assertEquals(Removal.NOT_FOUND, retireOrDeleteParty(Uuid.parse(party.id), userOneId, Clock.System.now()))
        }
    }
}
