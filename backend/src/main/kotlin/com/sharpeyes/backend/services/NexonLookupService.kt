package com.sharpeyes.backend.services

import com.sharpeyes.backend.users.GmsWorld
import com.sharpeyes.backend.users.KNOWN_WORLD_IDS
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.url
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Single client instance for the app's lifetime. Constructed once in
// Application.kt's module() and passed into NexonLookupService, not
// rebuilt per-request. ignoreUnknownKeys since Nexon's response carries
// ~10 fields (exp, gap, legionLevel, raidPower, tierID, score, characterID,
// rank, startRank, worldID, isSearchTarget) this app doesn't use.
fun createNexonHttpClient(): HttpClient =
    HttpClient(CIO) {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }

// Live-verified 2026-07-11: the nexon.com no-auth ranking endpoint's
// type=world requires a specific numeric world id. There is no
// single-call "search by name across all worlds." Probing ids 0-120 found
// only these 4 currently non-empty (modern GMS has consolidated into very
// few merged worlds). No human-readable world name is ever returned by
// this endpoint, only the numeric worldID.
//
// Which id is which world is therefore not something this service can read; it is knowledge, and
// it lives in GmsWorld with the record of how it was verified. That is also what makes the id
// worth returning: the world a character was FOUND in is the one they are in, which beats asking.
private const val LOOKUP_TIMEOUT_MS = 5_000L

data class NexonLookupResult(
    // Nexon's spelling. The endpoint matches case-insensitively, so what the caller typed is a
    // guess at the capitalisation and this is the only place the real one can be read.
    val name: String,
    val level: Int,
    val jobName: String,
    val spriteImgUrl: String,
    // Which world answered. Null for an id this build does not know, which cannot happen while the
    // fan-out reads its ids from the same enum, but says so rather than inventing a world if it
    // ever stops doing that.
    val world: GmsWorld?,
)

// First outbound HTTP call in this codebase. Preserves the "add character
// by name only" UX (WEB-UI-SPEC.md) despite the endpoint's per-world
// requirement by fanning out one concurrent lookup per known world and
// taking whichever one matches, rather than asking the user for their world.
class NexonLookupService(
    private val client: HttpClient,
) {
    // Never throws, a failed/timed-out/malformed lookup is indistinguishable
    // from "character not found" to callers, both falling through to manual
    // entry (POST /api/characters never errors because of this lookup).
    suspend fun lookup(characterName: String): NexonLookupResult? =
        supervisorScope {
            KNOWN_WORLD_IDS
                .map { worldId -> async { runCatching { queryWorld(worldId, characterName) }.getOrNull() } }
                .awaitAll()
                .filterNotNull()
                // Defensive: the same name matching >1 world simultaneously is
                // possible in principle. Take the first rather than crash.
                .firstOrNull()
        }

    private suspend fun queryWorld(
        worldId: Int,
        name: String,
    ): NexonLookupResult? {
        val response =
            withTimeout(LOOKUP_TIMEOUT_MS) {
                client.get("https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na") {
                    url {
                        parameters.append("type", "world")
                        parameters.append("id", worldId.toString())
                        parameters.append("page_index", "1")
                        parameters.append("character_name", name)
                    }
                }
            }
        val rank =
            response
                .takeIf { it.status == HttpStatusCode.OK }
                ?.body<NexonRankingResponse>()
                ?.ranks
                ?.firstOrNull()
                // The endpoint truncates character_name to 12 characters (the in-game limit) before
                // matching, so a longer typo answers with whoever owns its first 12: verified
                // 2026-08-09, "marrowwindyz" returns MarrowWind's level, job and sprite. Only a
                // row spelling the name we asked for is that character. See the test.
                ?.takeIf { it.characterName.equals(name, ignoreCase = true) }
        // The world is the one that ANSWERED, not one read off the row: the response's own worldID
        // is a field this app has never parsed, and taking it would make the fan-out and the answer
        // two things that can disagree.
        return rank?.let {
            NexonLookupResult(it.characterName, it.level, it.jobName, it.characterImgURL, GmsWorld.byId(worldId))
        }
    }
}

@Serializable
private data class NexonRankingResponse(
    val totalCount: Int,
    val ranks: List<NexonRankEntry>,
)

@Serializable
private data class NexonRankEntry(
    val characterName: String,
    val level: Int,
    val jobName: String,
    val characterImgURL: String,
)
