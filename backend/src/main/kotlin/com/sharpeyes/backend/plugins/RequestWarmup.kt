package com.sharpeyes.backend.plugins

import com.auth0.jwk.Jwk
import com.auth0.jwk.JwkProvider
import com.auth0.jwk.SigningKeyNotFoundException
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.sharpeyes.backend.config.Env
import io.ktor.server.application.Application
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.slf4j.LoggerFactory
import java.math.BigInteger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.time.Duration
import java.util.Base64
import java.util.Date
import kotlin.time.measureTime

private val log = LoggerFactory.getLogger("Warmup")

internal const val WARMUP_KID = "boot-warmup"
private const val TOKEN_LIFETIME_MILLIS = 60_000L
private const val REQUEST_TIMEOUT_SECONDS = 10L
private const val REQUEST_PASSES = 2
private const val P256_COORDINATE_BYTES = 32
private const val HTTP_OK = 200

// Party View's initial load, fired together as the page fires them.
private val PARTY_VIEW_READS = listOf("/api/pages/parties", "/api/pages/parties/extras", "/api/parties/pieces")

/**
 * Send Party View's reads through a real HTTP stack before this replica listens.
 *
 * warmReadPaths primes the queries, but not the request around them: token verification, the
 * handler, encoding and gzip. With only that warmup, the three reads cold took 121-164ms against
 * 34-40ms warm, and one signed-in request first brought them to 63-66ms. A request with no token
 * did nothing (114-130ms), so the warming request has to be signed in. Measured locally on 2 cores,
 * 21 parties and 200 loot rows, 2026-10-15.
 *
 * So: a throwaway server on loopback with the same plugins and routes, signed-in requests, stopped.
 * Compiled code is per JVM, so the real server inherits it. The real one cannot listen first and call
 * itself, because nginx has no active health checks and would route users to it while still cold.
 *
 * The token is signed by a key made here and dropped when this returns. Only the throwaway server's
 * verifier trusts it. Never fatal, like warmReadPaths.
 */
fun warmRequestPipeline(routes: Application.() -> Unit) {
    val elapsed =
        measureTime {
            runCatching {
                val account = transaction { busiestAccount()?.let { it to emailOf(it) } }
                if (account == null) {
                    log.info("Request warmup skipped: no accounts yet")
                    return
                }
                sendReads(account.first, account.second, routes)
            }.onFailure { log.warn("Request warmup failed, the first request will pay for it", it) }
        }
    log.info("Warmup: request pipeline primed in ${elapsed.inWholeMilliseconds}ms")
}

private fun sendReads(
    userId: String,
    email: String,
    routes: Application.() -> Unit,
) {
    val keys =
        KeyPairGenerator
            .getInstance(
                "EC",
            ).apply { initialize(ECGenParameterSpec("secp256r1")) }
            .generateKeyPair()
    val publicKey = keys.public as ECPublicKey
    val server =
        embeddedServer(Netty, port = 0, host = "127.0.0.1") {
            configureTiming()
            configureSerialization()
            configureCompression()
            configureCors()
            configureSecurity(jwkProvider = onlyKey(publicKey))
            routes()
        }.start(wait = false)
    try {
        val port =
            runBlocking {
                server.engine
                    .resolvedConnectors()
                    .first()
                    .port
            }
        val token =
            JWT
                .create()
                .withKeyId(WARMUP_KID)
                .withIssuer(Env.authIssuer)
                .withAudience(Env.authAudience)
                .withSubject(userId)
                .withClaim("email", email)
                .withExpiresAt(Date(System.currentTimeMillis() + TOKEN_LIFETIME_MILLIS))
                .sign(Algorithm.ECDSA256(publicKey, keys.private as ECPrivateKey))
        val client = HttpClient.newHttpClient()
        repeat(REQUEST_PASSES) {
            PARTY_VIEW_READS
                .map { path ->
                    val request =
                        HttpRequest
                            .newBuilder(URI("http://127.0.0.1:$port$path"))
                            .header("Authorization", "Bearer $token")
                            .header("Accept-Encoding", "gzip")
                            .header("Origin", Env.frontendOrigin)
                            .timeout(Duration.ofSeconds(REQUEST_TIMEOUT_SECONDS))
                            .build()
                    path to client.sendAsync(request, BodyHandlers.discarding())
                }.forEach { (path, response) ->
                    val status = response.join().statusCode()
                    check(status == HTTP_OK) { "$path answered $status" }
                }
        }
    } finally {
        server.stop(0, 0)
    }
}

internal fun onlyKey(key: ECPublicKey) =
    JwkProvider { kid ->
        if (kid != WARMUP_KID) throw SigningKeyNotFoundException("Only the warmup key is known here", null)
        Jwk.fromValues(
            mapOf(
                "kid" to WARMUP_KID,
                "kty" to "EC",
                "alg" to "ES256",
                "crv" to "P-256",
                "x" to coordinate(key.w.affineX),
                "y" to coordinate(key.w.affineY),
            ),
        )
    }

private fun coordinate(value: BigInteger): String {
    // toByteArray is signed and minimal, so it can carry a leading zero or come up short.
    val raw = value.toByteArray().takeLast(P256_COORDINATE_BYTES).toByteArray()
    val padded = ByteArray(P256_COORDINATE_BYTES - raw.size) + raw
    return Base64.getUrlEncoder().withoutPadding().encodeToString(padded)
}
