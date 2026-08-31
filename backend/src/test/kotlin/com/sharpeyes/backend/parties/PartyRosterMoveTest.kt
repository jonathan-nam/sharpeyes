package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.users.ensureUser
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Moving a character from one party to another on the same boss, against a real Postgres.
 *
 * A character is in one party per boss, so this is a refusal with a second way through rather than
 * a rule being relaxed: the save says which party holds them, and the same save sent back with that
 * party's id does both halves at once. Reported 2026-08-31, as a save that appeared to do nothing.
 */
class PartyRosterMoveTest {
    private val userId = "user_test_roster_move"
    private val otherUserId = "user_test_roster_move_other"

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
            listOf(userId, otherUserId).forEach { owner ->
                Characters
                    .selectAll()
                    .where { Characters.userId eq owner }
                    .map { it[Characters.id] }
                    .forEach { id -> BossClear.deleteWhere { characterId eq id } }
                Screenshots.deleteWhere { Screenshots.userId eq owner }
                Party.deleteWhere { Party.userId eq owner }
                Characters.deleteWhere { Characters.userId eq owner }
            }
        }
    }

    private fun character(
        name: String,
        owner: String = userId,
    ): Uuid {
        ensureUser(owner, "$owner@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun config(
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
        shares: Map<String, Int> = emptyMap(),
        owner: String = userId,
    ): PartyResponse {
        val request = SavePartyRequest(characterId.toString(), bossKey, members, shares = shares)
        val id = createParty(owner, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now())
        return findParty(id, owner)!!
    }

    /** The save the route makes, through the same composition. See writeSavedParty. */
    private fun save(
        party: PartyResponse,
        members: List<String>,
        releaseFrom: List<String> = emptyList(),
    ): Any? =
        writeSavedParty(
            userId,
            Uuid.parse(party.id),
            SavePartyRequest(party.characterId, party.bossKey, members, releaseFrom = releaseFrom),
            Clock.System.now(),
        )

    private fun standingRoster(partyId: String): List<String> =
        findParty(Uuid.parse(partyId), userId)
            ?.members
            ?.filter { !it.guest }
            ?.map { it.name }
            .orEmpty()

    /*
     * The wire contract, pinned on this side of it.
     *
     * lib/roster-conflict.ts reads these four names and refuses the WHOLE offer if any one of them
     * is missing, on purpose: a half-read conflict would name the wrong party or claim one survives
     * a move that removes it. So renaming a field here turns the move quietly back into the dead
     * end it replaced, with every other test still green.
     */
    @Test
    fun `the conflict serialises under the names the client reads`() {
        val moves = listOf(RosterMoveResponse("p1", "CourseLair", "HuskyxKenshi", removesParty = true))
        assertEquals(
            """{"message":"held","moves":[{"partyId":"p1","member":"CourseLair",""" +
                """"fromCharacter":"HuskyxKenshi","removesParty":true}]}""",
            Json.encodeToString(RosterConflictResponse("held", moves)),
        )
    }

    @Test
    fun `a save that wants somebody else's seat says which party holds it, and does not write`() {
        transaction {
            val husky = character("HuskyxKenshi")
            val onetwothreeo = character("onetwothreeo")
            val duo = config(husky, "limbo", listOf("CourseLair"))
            val trio = config(onetwothreeo, "limbo", listOf("Freeballynn", "Haruko"))

            val outcome = save(trio, listOf("Freeballynn", "Haruko", "CourseLair"))

            // A conflict rather than a flat refusal: the screen has to be able to offer the move,
            // which means knowing whose party to take the seat from and what that does to it.
            val conflict = assertIs<RosterConflictResponse>(outcome)
            assertEquals("CourseLair is already in your HuskyxKenshi party for this boss", conflict.message)
            assertEquals(1, conflict.moves.size)
            assertEquals(duo.id, conflict.moves[0].partyId)
            assertEquals("CourseLair", conflict.moves[0].member)
            assertEquals("HuskyxKenshi", conflict.moves[0].fromCharacter)
            // A duo minus its one other member is a solo run, which is not a party.
            assertTrue(conflict.moves[0].removesParty)

            // Nothing was written. The whole failure this replaces was a save that looked like it
            // had done something.
            assertEquals(listOf("onetwothreeo", "Freeballynn", "Haruko"), standingRoster(trio.id))
            assertEquals(listOf("HuskyxKenshi", "CourseLair"), standingRoster(duo.id))
        }
    }

    @Test
    fun `naming the party in releaseFrom moves the seat and takes the emptied party with it`() {
        transaction {
            val husky = character("HuskyxKenshi")
            val onetwothreeo = character("onetwothreeo")
            val duo = config(husky, "limbo", listOf("CourseLair"))
            val trio = config(onetwothreeo, "limbo", listOf("Freeballynn", "Haruko"))

            val saved =
                assertIs<PartyResponse>(
                    save(trio, listOf("Freeballynn", "Haruko", "CourseLair"), releaseFrom = listOf(duo.id)),
                )

            assertEquals(
                listOf("onetwothreeo", "Freeballynn", "Haruko", "CourseLair"),
                saved.members.filter { !it.guest }.map { it.name },
            )
            // Husky is left running Limbo alone, which is not a party. It holds no drops, so it goes
            // the way Remove sends an empty one.
            assertNull(findParty(Uuid.parse(duo.id), userId))
        }
    }

    @Test
    fun `a party with somebody else left in it shrinks rather than going`() {
        transaction {
            val husky = character("HuskyxKenshi")
            val onetwothreeo = character("onetwothreeo")
            val trioOfHusky = config(husky, "limbo", listOf("CourseLair", "Blaze"))
            val pair = config(onetwothreeo, "limbo", listOf("Freeballynn"))

            val conflict =
                assertIs<RosterConflictResponse>(save(pair, listOf("Freeballynn", "CourseLair")))
            assertFalse(conflict.moves[0].removesParty)

            assertIs<PartyResponse>(
                save(pair, listOf("Freeballynn", "CourseLair"), releaseFrom = listOf(trioOfHusky.id)),
            )
            assertEquals(listOf("HuskyxKenshi", "Blaze"), standingRoster(trioOfHusky.id))
        }
    }

    @Test
    fun `the party a seat is taken from keeps what its remaining seats take`() {
        transaction {
            val husky = character("HuskyxKenshi")
            val onetwothreeo = character("onetwothreeo")
            // Husky's party is not an even split: Blaze takes two shares to Husky's one.
            val theirs =
                config(
                    husky,
                    "limbo",
                    listOf("CourseLair", "Blaze"),
                    shares = mapOf("HuskyxKenshi" to 1, "CourseLair" to 1, "Blaze" to 2),
                )
            val mine = config(onetwothreeo, "limbo", listOf("Freeballynn"))

            assertIs<PartyResponse>(
                save(mine, listOf("Freeballynn", "CourseLair"), releaseFrom = listOf(theirs.id)),
            )

            // Releasing a seat is an edit of that party, so it goes through writeMembers, which
            // reads a name it is not given as one share. Passing only the members would have
            // flattened this deal to 1:1 as a side effect of a save on another party entirely.
            val left = findParty(Uuid.parse(theirs.id), userId)!!
            assertEquals(
                mapOf("HuskyxKenshi" to 1, "Blaze" to 2),
                left.members.filter { !it.guest }.associate {
                    it.name to
                        it.shares
                },
            )
        }
    }

    @Test
    fun `releaseFrom cannot empty a party this save was not taking from`() {
        transaction {
            val husky = character("HuskyxKenshi")
            val onetwothreeo = character("onetwothreeo")
            // Nobody in this one is wanted by the save below, so agreeing to empty it was never
            // offered and must not be honoured.
            val unrelated = config(husky, "kaling", listOf("Blaze"))
            val mine = config(onetwothreeo, "limbo", listOf("Freeballynn"))

            val outcome = save(mine, listOf("Freeballynn", "NewPerson"), releaseFrom = listOf(unrelated.id))

            assertEquals("releaseFrom names a party this save does not take anybody from", outcome)
            assertEquals(listOf("HuskyxKenshi", "Blaze"), standingRoster(unrelated.id))
        }
    }

    @Test
    fun `a move never reaches another account's party`() {
        transaction {
            val theirs = character("SomebodyElse", owner = otherUserId)
            val onetwothreeo = character("onetwothreeo")
            val notMine = config(theirs, "limbo", listOf("CourseLair"), owner = otherUserId)
            val mine = config(onetwothreeo, "limbo", listOf("Freeballynn"))

            // Their party holds CourseLair, and it is invisible to this rule: the clash is only ever
            // about your own configs, so this saves rather than offering to empty somebody else's.
            assertIs<PartyResponse>(save(mine, listOf("Freeballynn", "CourseLair")))
            assertEquals(
                listOf("SomebodyElse", "CourseLair"),
                findParty(Uuid.parse(notMine.id), otherUserId)!!.members.filter { !it.guest }.map { it.name },
            )
        }
    }
}
