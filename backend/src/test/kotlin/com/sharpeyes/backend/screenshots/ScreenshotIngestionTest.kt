package com.sharpeyes.backend.screenshots

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Screenshots
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.services.CharacterHud
import com.sharpeyes.backend.services.DetectedToken
import com.sharpeyes.backend.services.FakeScreenshotParser
import com.sharpeyes.backend.services.ScreenshotParseOutcome
import com.sharpeyes.backend.services.ScreenshotParseResult
import com.sharpeyes.backend.services.ScreenshotType
import com.sharpeyes.backend.users.ensureUser
import kotlinx.coroutines.runBlocking
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The key the SCREENSHOT PARSER emits, token_catalog.vision_key, which is the
// name of its template file. Not the display name.
//
// This constant used to be "Distorted Ambition", the catalog's display name, and
// that is why these tests stayed green while token persistence was completely
// broken: the vision model was prompted to echo display names back, so the fake
// echoed them too, and the tests asserted a contract the real OpenCV parser never
// honoured. It emits slugs. Nothing matched, and the lookup's `?: continue`
// swallowed every token in silence.
//
// Keep this as the parser's key. If it ever drifts from vision/app/cv/templates/,
// these tests must fail.
private const val DISTORTED_AMBITION = "distorted-ambition"

// A second real vision_key, so the clear-on-complete tests can watch one item vanish while
// another survives in the same write.
private const val KALOS_TOKEN = "kalos-token"
private const val TEST_USER_ID = "user_test_screenshots"

// Exercises ScreenshotIngestion's outcome-branching (the actually-novel logic
// here) against FakeScreenshotParser + real Postgres. Same DB_* contract
// as TokenCatalogSeedTest.kt / CharacterRepositoryTest.kt, no HTTP/auth layer.
//
// Uses the TEST_USER_ID constant directly (not a `userId` property) rather
// than a same-named local variable. Inside `Table.insert { }`/`.update { }`
// lambdas the receiver is the Table itself, so a bare `userId` there resolves
// to `Characters.userId` (the column), not an outer property of the same
// name, silently mis-generating SQL. Always qualify column keys as
// `Characters.userId` and pass the plain constant as the value to avoid this.
class ScreenshotIngestionTest {
    private val createdCharacterIds = mutableListOf<Uuid>()

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
        transaction { ensureUser(TEST_USER_ID, "screenshots-test@example.com") }
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            for (characterId in createdCharacterIds) {
                CharacterTokenCount.deleteWhere { CharacterTokenCount.characterId eq characterId }
            }
            Screenshots.deleteWhere { Screenshots.userId eq TEST_USER_ID }
            Characters.deleteWhere { Characters.userId eq TEST_USER_ID }
        }
        createdCharacterIds.clear()
    }

    @Test
    fun `matched, Pinned character and HUD name agree upserts token counts`() {
        val characterId = insertCharacter("Bubbling")
        val fake =
            FakeScreenshotParser(
                parsedOutcome(
                    hud = CharacterHud("Bubbling", 285),
                    tokens = listOf(DetectedToken(DISTORTED_AMBITION, 3)),
                ),
            )

        val result = runBlocking { ingest(fake, pinnedCharacterId = characterId) }

        assertEquals(ScreenshotOutcome.MATCHED, result.outcome)
        assertEquals(3, tokenCountFor(characterId))
    }

    @Test
    fun `matched, No pin but HUD name matches an existing character by name`() {
        val characterId = insertCharacter("Nightshade")
        val fake =
            FakeScreenshotParser(
                parsedOutcome(
                    hud = CharacterHud("nightshade", 200), // case-insensitive match
                    tokens = listOf(DetectedToken(DISTORTED_AMBITION, 1)),
                ),
            )

        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }

        assertEquals(ScreenshotOutcome.MATCHED, result.outcome)
        assertEquals(1, tokenCountFor(characterId))
    }

    @Test
    fun `mismatch, Pinned character disagrees with detected HUD name, no write`() {
        val characterId = insertCharacter("Alpha")
        val fake =
            FakeScreenshotParser(
                parsedOutcome(
                    hud = CharacterHud("Beta", 100),
                    tokens = listOf(DetectedToken(DISTORTED_AMBITION, 5)),
                ),
            )

        val result = runBlocking { ingest(fake, pinnedCharacterId = characterId) }

        assertEquals(ScreenshotOutcome.MISMATCH, result.outcome)
        assertEquals("Beta", result.detectedCharacterName)
        assertEquals("Alpha", result.pinnedCharacterName)
        assertNull(tokenCountFor(characterId))
        assertEquals("NEEDS_REVIEW", screenshotParseStatus(result.screenshotId))
    }

    @Test
    fun `newCharacterDetected, No pin and HUD name matches no existing character`() {
        val fake =
            FakeScreenshotParser(
                parsedOutcome(hud = CharacterHud("Ghostface", 50), tokens = emptyList()),
            )

        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }

        assertEquals(ScreenshotOutcome.NEW_CHARACTER_DETECTED, result.outcome)
        assertEquals("Ghostface", result.detectedCharacterName)
    }

    @Test
    fun `matched, a pin attributes on its own when no HUD is in frame`() {
        val characterId = insertCharacter("Pinned")
        val fake =
            FakeScreenshotParser(parsedOutcome(hud = null, tokens = listOf(DetectedToken(DISTORTED_AMBITION, 2))))

        val result = runBlocking { ingest(fake, pinnedCharacterId = characterId) }

        // A cropped inventory with a pin is the documented happy path, the upload
        // page tells people it works. Nothing in the image contradicts the pin, so the
        // counts save rather than asking the user to name a character they just named.
        assertEquals(ScreenshotOutcome.MATCHED, result.outcome)
        assertEquals(2, tokenCountFor(characterId))
    }

    @Test
    fun `unresolvable, No HUD visible and no pin, so nobody knows whose this is`() {
        val fake =
            FakeScreenshotParser(parsedOutcome(hud = null, tokens = listOf(DetectedToken(DISTORTED_AMBITION, 2))))

        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }

        assertEquals(ScreenshotOutcome.UNRESOLVABLE, result.outcome)
    }

    @Test
    fun `unresolvable, a pin to a character that is not the caller's never auto-attributes`() {
        val mine = insertCharacter("Mine")
        val fake =
            FakeScreenshotParser(
                parsedOutcome(hud = CharacterHud("Mine", 200), tokens = listOf(DetectedToken(DISTORTED_AMBITION, 2))),
            )

        // A pin we cannot resolve must not fall through to HUD-based attribution: the
        // HUD names "Mine", and saving to them would quietly honour a character the
        // user never picked.
        val result = runBlocking { ingest(fake, pinnedCharacterId = Uuid.random()) }

        assertEquals(ScreenshotOutcome.UNRESOLVABLE, result.outcome)
        assertNull(tokenCountFor(mine))
    }

    @Test
    fun `unrecognizedScreenshot, the parser classifies the image as not a MapleStory inventory`() {
        val fake =
            FakeScreenshotParser(
                ScreenshotParseOutcome.Parsed(
                    result = ScreenshotParseResult(ScreenshotType.UNRECOGNIZED, null, null),
                ),
            )

        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }

        assertEquals(ScreenshotOutcome.UNRECOGNIZED_SCREENSHOT, result.outcome)
    }

    @Test
    fun `failed, the vision service is unreachable`() {
        val fake = FakeScreenshotParser(ScreenshotParseOutcome.Failed("rate limited"))

        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }

        assertEquals(ScreenshotOutcome.FAILED, result.outcome)
        assertEquals("rate limited", result.failureReason)
        assertEquals("FAILED", screenshotParseStatus(result.screenshotId))
    }

    @Test
    fun `upsert overwrites a prior quantity rather than accumulating`() {
        val characterId = insertCharacter("Restacker")
        val first =
            FakeScreenshotParser(
                parsedOutcome(CharacterHud("Restacker", 1), listOf(DetectedToken(DISTORTED_AMBITION, 3))),
            )
        val second =
            FakeScreenshotParser(
                parsedOutcome(CharacterHud("Restacker", 1), listOf(DetectedToken(DISTORTED_AMBITION, 7))),
            )

        runBlocking { ingest(first, pinnedCharacterId = characterId) }
        runBlocking { ingest(second, pinnedCharacterId = characterId) }

        assertEquals(7, tokenCountFor(characterId))
    }

    @Test
    fun `resolve attributes an already-parsed NEEDS_REVIEW screenshot to a chosen character`() {
        val newCharacter = insertCharacter("ResolvedTo")
        val fake =
            FakeScreenshotParser(parsedOutcome(hud = null, tokens = listOf(DetectedToken(DISTORTED_AMBITION, 4))))
        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }
        assertEquals(ScreenshotOutcome.UNRESOLVABLE, result.outcome)

        val resolved = runBlocking { resolveScreenshot(TEST_USER_ID, Uuid.parse(result.screenshotId), newCharacter) }

        assertTrue(resolved)
        assertEquals(4, tokenCountFor(newCharacter))
        assertEquals("SUCCESS", screenshotParseStatus(result.screenshotId))
    }

    @Test
    fun `ignore dismisses a NEEDS_REVIEW screenshot without writing token counts`() {
        val fake = FakeScreenshotParser(parsedOutcome(hud = null, tokens = emptyList()))
        val result = runBlocking { ingest(fake, pinnedCharacterId = null) }

        val ignored = runBlocking { ignoreScreenshot(TEST_USER_ID, Uuid.parse(result.screenshotId)) }

        assertTrue(ignored)
        assertEquals("IGNORED", screenshotParseStatus(result.screenshotId))
    }

    // A count can only ever be OVERWRITTEN by a new sighting, never cleared, unless the capture
    // is known to have shown the whole inventory. These four pin both halves of that.
    //
    // The bug: mechyfechy kept 50 Kaling pieces for 37 minutes after a capture that had none,
    // because absence carried no information. The trap on the way to fixing it: two captures of
    // that same character each detected 24 items and each missed one the other found, so a naive
    // absence-means-zero would have deleted a real 830-symbol stack.

    @Test
    fun `a complete capture clears an item it no longer sees`() {
        val characterId = insertCharacter("Spender")
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("Spender", 1),
                        listOf(DetectedToken(DISTORTED_AMBITION, 3), DetectedToken(KALOS_TOKEN, 50)),
                        inventoryComplete = true,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }
        assertEquals(50, tokenCountFor(characterId, KALOS_TOKEN))

        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("Spender", 1),
                        listOf(DetectedToken(DISTORTED_AMBITION, 3)),
                        inventoryComplete = true,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }

        assertNull(tokenCountFor(characterId, KALOS_TOKEN), "spent stack should be gone")
        assertEquals(3, tokenCountFor(characterId, DISTORTED_AMBITION), "seen item is untouched")
    }

    @Test
    fun `an incomplete capture leaves an item it did not see alone`() {
        val characterId = insertCharacter("Cropped")
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("Cropped", 1),
                        listOf(DetectedToken(DISTORTED_AMBITION, 3), DetectedToken(KALOS_TOKEN, 830)),
                        inventoryComplete = true,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }

        // The item is off-frame or covered, not gone. Deleting here is the data loss this
        // whole flag exists to prevent.
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("Cropped", 1),
                        listOf(DetectedToken(DISTORTED_AMBITION, 3)),
                        inventoryComplete = false,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }

        assertEquals(830, tokenCountFor(characterId, KALOS_TOKEN), "unseen item must survive")
    }

    @Test
    fun `a parser that reports no completeness at all never clears`() {
        val characterId = insertCharacter("OldParser")
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("OldParser", 1),
                        listOf(DetectedToken(KALOS_TOKEN, 12)),
                        inventoryComplete = true,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }

        // Null, as a vision service that predates the flag would send. Absence of evidence
        // is not evidence of absence, so this must behave like the incomplete case.
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("OldParser", 1),
                        listOf(DetectedToken(DISTORTED_AMBITION, 1)),
                        inventoryComplete = null,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }

        assertEquals(12, tokenCountFor(characterId, KALOS_TOKEN))
    }

    @Test
    fun `a complete capture of an emptied inventory clears every count`() {
        val characterId = insertCharacter("Emptied")
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(
                        CharacterHud("Emptied", 1),
                        listOf(DetectedToken(DISTORTED_AMBITION, 3), DetectedToken(KALOS_TOKEN, 4)),
                        inventoryComplete = true,
                    ),
                ),
                pinnedCharacterId = characterId,
            )
        }

        // Empty payload, so there is no "seen" list to exclude against. Pinned because the
        // obvious notInList spelling of the delete is a no-op on an empty list.
        runBlocking {
            ingest(
                FakeScreenshotParser(
                    parsedOutcome(CharacterHud("Emptied", 1), emptyList(), inventoryComplete = true),
                ),
                pinnedCharacterId = characterId,
            )
        }

        assertNull(tokenCountFor(characterId, DISTORTED_AMBITION))
        assertNull(tokenCountFor(characterId, KALOS_TOKEN))
    }

    private fun parsedOutcome(
        hud: CharacterHud?,
        tokens: List<DetectedToken>,
        inventoryComplete: Boolean? = null,
    ) = ScreenshotParseOutcome.Parsed(
        result = ScreenshotParseResult(ScreenshotType.INVENTORY, hud, tokens, inventoryComplete = inventoryComplete),
    )

    private suspend fun ingest(
        fake: FakeScreenshotParser,
        pinnedCharacterId: Uuid?,
    ) = ingestScreenshot(
        userId = TEST_USER_ID,
        email = "screenshots-test@example.com",
        // Content is irrelevant, the fake never reads it.
        request = UploadScreenshotRequest(imageBase64 = "aGVsbG8=", mediaType = "image/png"),
        pinnedCharacterId = pinnedCharacterId,
        screenshotParser = fake,
    )

    private fun insertCharacter(name: String): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        transaction {
            // position is NOT NULL and app-assigned (no DB default), dense per user. Mirror the
            // route's append: the count of this user's rows is the next free slot. See CharacterRoutes.
            val nextPosition =
                Characters
                    .selectAll()
                    .where { Characters.userId eq TEST_USER_ID }
                    .count()
                    .toInt()
            Characters.insert {
                it[Characters.id] = id
                it[Characters.userId] = TEST_USER_ID
                it[Characters.name] = name
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = nextPosition
            }
        }
        createdCharacterIds += id
        return id
    }

    private fun tokenCountFor(
        characterId: Uuid,
        visionKey: String,
    ): Int? =
        transaction {
            CharacterTokenCount
                .innerJoin(TokenCatalog)
                .selectAll()
                .where { (CharacterTokenCount.characterId eq characterId) and (TokenCatalog.visionKey eq visionKey) }
                .singleOrNull()
                ?.get(CharacterTokenCount.quantity)
        }

    private fun tokenCountFor(characterId: Uuid): Int? =
        transaction {
            CharacterTokenCount
                .selectAll()
                .where { CharacterTokenCount.characterId eq characterId }
                .singleOrNull()
                ?.get(CharacterTokenCount.quantity)
        }

    private fun screenshotParseStatus(screenshotId: String): String =
        transaction {
            Screenshots
                .selectAll()
                .where { (Screenshots.id eq Uuid.parse(screenshotId)) and (Screenshots.userId eq TEST_USER_ID) }
                .single()[Screenshots.parseStatus]
        }
}
