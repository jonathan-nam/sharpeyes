package com.sharpeyes.backend.sprites

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.CharacterSprite
import com.sharpeyes.backend.db.IgnSprite
import com.sharpeyes.backend.services.NexonLookupService
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant

/**
 * The one lookup every typed IGN goes through (V95): it asks Nexon once per name and answers from
 * what it recorded until the answer is a week old, misses included.
 */
class IgnSpritesTest {
    // Invented names: see CLAUDE.md, "No PII or real IGNs".
    private val found = "Thornwick"
    private val missing = "Pellmoor"
    private val spriteUrl = "https://msavatar1.nexon.net/Character/ign-sprites-test.png"
    private val now = Instant.parse("2026-10-24T12:00:00Z")
    private val png = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10) + ByteArray(256)

    // Nexon calls made, one per world asked. Only whether it moved matters.
    private var nexonCalls = 0

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
        val keys = listOf(found, missing).map { it.lowercase() }
        val url = spriteUrl
        transaction {
            IgnSprite.deleteWhere { IgnSprite.nameKey inList keys }
            CharacterSprite.deleteWhere { CharacterSprite.sourceUrl inList listOf(url) }
        }
    }

    /** A Nexon that knows only [found], and serves a PNG for its sprite. */
    private fun services(): Pair<NexonLookupService, SpriteCache> {
        val engine =
            MockEngine { request ->
                if (request.url.host == "www.nexon.com") {
                    nexonCalls++
                    val asked = request.url.toString().contains(found, ignoreCase = true)
                    val ranking =
                        if (asked) {
                            """{"totalCount":1,"ranks":[{"characterName":"$found","level":280,""" +
                                """"jobName":"Hero","characterImgURL":"$spriteUrl"}]}"""
                        } else {
                            """{"totalCount":0,"ranks":[]}"""
                        }
                    respond(ranking, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                } else {
                    respond(
                        png,
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, ContentType.Image.PNG.toString()),
                    )
                }
            }
        val client = HttpClient(engine) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } }
        return NexonLookupService(client) to SpriteCache(client)
    }

    @Test
    fun `asks Nexon once, then answers from what it recorded, case-blind`() =
        runBlocking {
            val (nexon, cache) = services()
            assertEquals(spriteUrl, lookUpIgns(listOf(found), nexon, cache, now)[found.lowercase()])
            val asked = nexonCalls
            val again = lookUpIgns(listOf(found.uppercase()), nexon, cache, now + 1.days)
            assertEquals(spriteUrl, again[found.lowercase()])
            assertEquals(asked, nexonCalls)
            assertEquals(mapOf(found.lowercase() to spriteUrl), transaction { knownIgnSprites(listOf(found)) })
        }

    @Test
    fun `records a miss, and asks about it again only after a week`() =
        runBlocking {
            val (nexon, cache) = services()
            assertNull(lookUpIgns(listOf(missing), nexon, cache, now)[missing.lowercase()])
            val asked = nexonCalls
            lookUpIgns(listOf(missing), nexon, cache, now + 6.days)
            assertEquals(asked, nexonCalls)
            lookUpIgns(listOf(missing), nexon, cache, now + 8.days)
            assertEquals(true, nexonCalls > asked)
        }

    @Test
    fun `never asks about a name the game could not have`() =
        runBlocking {
            val (nexon, cache) = services()
            val answer = lookUpIgns(listOf("", "two words", "x".repeat(MAX_IGN_LENGTH + 1)), nexon, cache, now)
            assertEquals(emptyMap(), answer)
            assertEquals(0, nexonCalls)
        }
}
