package com.maplestorage.backend.plugins

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.sun.net.httpserver.HttpServer
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import java.net.InetSocketAddress
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.Date
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The backend verifies an ES256 token against a JWKS, which is what the auth service issues.
 *
 * This exists because of one trap, and it is worth reading before changing the algorithm. Better
 * Auth's JWT plugin defaults to **EdDSA (Ed25519)**, and auth0's java-jwt below implements HMAC,
 * RSA and ECDSA and no EdDSA at all. On the default, the auth service starts, serves a JWKS, mints
 * tokens, and every single request here 401s. auth/src/auth.ts pins ES256 for this reason; this
 * asserts the other half, that ES256 is a shape this code path can actually check.
 *
 * The signature is not the whole test. A token minted by the right service for something else is
 * still not a token for this API, so the issuer and audience are asserted too.
 */
class SessionJwtTest {
    private val issuer = "https://auth.test.invalid"
    private val audience = "sharpeyes-api"
    private val keyId = "test-key"

    private fun keyPair(): KeyPair =
        KeyPairGenerator
            .getInstance("EC")
            .apply { initialize(ECGenParameterSpec("secp256r1")) }
            .generateKeyPair()

    /** Fixed-width unsigned big-endian, which is what a JWK coordinate is. */
    private fun coordinate(value: java.math.BigInteger): String {
        val full = ByteArray(P256_COORDINATE_BYTES)
        val raw = value.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
        raw.copyInto(full, full.size - raw.size)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(full)
    }

    /** The JWKS the auth service would publish, served over real HTTP: JwkProvider fetches it. */
    private fun serveJwks(public: ECPublicKey): HttpServer {
        val body =
            """
            {"keys":[{"kty":"EC","crv":"P-256","alg":"ES256","use":"sig","kid":"$keyId",
            "x":"${coordinate(public.w.affineX)}","y":"${coordinate(public.w.affineY)}"}]}
            """.trimIndent()
        return HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/jwks") { exchange ->
                val bytes = body.toByteArray()
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            start()
        }
    }

    private fun token(
        pair: KeyPair,
        tokenIssuer: String = issuer,
        tokenAudience: String = audience,
    ): String =
        JWT
            .create()
            .withKeyId(keyId)
            .withIssuer(tokenIssuer)
            .withAudience(tokenAudience)
            .withSubject("auth-user-id")
            .withExpiresAt(Date(System.currentTimeMillis() + ONE_MINUTE_MILLIS))
            .sign(Algorithm.ECDSA256(pair.public as ECPublicKey, pair.private as ECPrivateKey))

    private fun withAuth(
        pair: KeyPair,
        block: suspend (send: suspend (String?) -> HttpResponse) -> Unit,
    ) {
        val jwks = serveJwks(pair.public as ECPublicKey)
        try {
            testApplication {
                application {
                    configureSecurity(
                        jwksUrl = "http://127.0.0.1:${jwks.address.port}/jwks",
                        issuer = issuer,
                        audience = audience,
                    )
                    routing {
                        authenticate(SESSION_AUTH) {
                            get("/guarded") { call.respondText("ok") }
                        }
                    }
                }
                block { bearer ->
                    client.get("/guarded") {
                        if (bearer != null) header("Authorization", "Bearer $bearer")
                    }
                }
            }
        } finally {
            jwks.stop(0)
        }
    }

    @Test
    fun `an ES256 token signed by the published key is accepted`() {
        val pair = keyPair()
        withAuth(pair) { send ->
            assertEquals(HttpStatusCode.OK, send(token(pair)).status)
        }
    }

    @Test
    fun `a token for another audience is refused`() {
        val pair = keyPair()
        withAuth(pair) { send ->
            assertEquals(
                HttpStatusCode.Unauthorized,
                send(token(pair, tokenAudience = "somebody-elses-api")).status,
            )
        }
    }

    @Test
    fun `a token from another issuer is refused`() {
        val pair = keyPair()
        withAuth(pair) { send ->
            assertEquals(
                HttpStatusCode.Unauthorized,
                send(token(pair, tokenIssuer = "https://not-us.invalid")).status,
            )
        }
    }

    @Test
    fun `a token signed by a key the JWKS does not publish is refused`() {
        // The whole point of fetching keys rather than sharing a secret: a well-formed token from
        // the wrong signer has to fail, or the JWKS is decoration.
        val published = keyPair()
        val impostor = keyPair()
        withAuth(published) { send ->
            assertEquals(HttpStatusCode.Unauthorized, send(token(impostor)).status)
        }
    }

    @Test
    fun `no token at all is refused`() {
        val pair = keyPair()
        withAuth(pair) { send ->
            assertEquals(HttpStatusCode.Unauthorized, send(null).status)
        }
    }

    private companion object {
        const val P256_COORDINATE_BYTES = 32
        const val ONE_MINUTE_MILLIS = 60_000L
    }
}
