package com.sharpeyes.backend.parties

import com.sharpeyes.api.parties.SavePartyRequest
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
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
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFailsWith
import kotlin.time.Clock
import kotlin.uuid.Uuid

/** The database's backstop for one live party per character per boss. See V100. */
class OnePartyPerBossTest {
    private val xan = "user_test_oneparty_xan"
    private val yew = "user_test_oneparty_yew"
    private val everyone = listOf(xan, yew)
    private val kalos = "kalos-the-guardian"

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
            Party.deleteWhere { Party.userId inList everyone }
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
            it[worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun party(
        owner: String,
        own: Uuid,
        vararg members: String,
    ): Uuid =
        createParty(
            owner,
            own,
            bossIdForKey(kalos)!!,
            SavePartyRequest(own.toString(), kalos, members.toList()),
            Clock.System.now(),
        )

    /** A standing seat named [name] in [partyId], written straight past the app's own checks. */
    private fun seat(
        partyId: Uuid,
        name: String,
        linked: Uuid? = null,
    ) = PartyMember.insert {
        it[id] = Uuid.random()
        it[PartyMember.partyId] = partyId
        it[PartyMember.name] = name
        it[linkedCharacterId] = linked
        it[position] = 9
        it[standing] = true
        it[shares] = 1
        it[pieceShares] = 1
    }

    @Test
    fun `a name in two of one account's parties for a boss is refused at commit`() {
        val second =
            transaction {
                party(xan, character(xan, "Thornwick"), "Larkspur")
                party(xan, character(xan, "Quillon"), "Pellmoor")
            }

        val refused = assertFailsWith<Exception> { transaction { seat(second, "Larkspur") } }
        assertContains(refused.message.orEmpty(), "Larkspur is already in another party for this boss")
    }

    @Test
    fun `a character in two accounts' parties for a boss is refused, and retiring one frees them`() {
        val (thorn, theirs) =
            transaction {
                val thorn = character(xan, "Thornwick")
                party(xan, thorn, "Larkspur")
                thorn to party(yew, character(yew, "Pellmoor"), "Quillon")
            }

        assertFailsWith<Exception> { transaction { seat(theirs, "Thornwick", linked = thorn) } }

        // Two accounts naming one person by a name alone are two books until they combine.
        transaction { seat(theirs, "Larkspur") }
        // Once Xan's party stands no more, the character is free to sit in Yew's.
        transaction {
            Party.update({ (Party.userId eq xan) and (Party.characterId eq thorn) }) { it[standing] = false }
            seat(theirs, "Thornwick", linked = thorn)
        }
    }
}
