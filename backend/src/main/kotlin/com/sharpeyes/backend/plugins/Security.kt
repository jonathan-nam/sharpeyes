package com.sharpeyes.backend.plugins

import com.auth0.jwk.JwkProvider
import com.auth0.jwk.JwkProviderBuilder
import com.auth0.jwk.UrlJwkProvider
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.interfaces.Verification
import com.sharpeyes.backend.config.Env
import io.ktor.http.HttpHeaders
import io.ktor.http.auth.HttpAuthHeader
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.auth.Authentication
import io.ktor.server.auth.UnauthorizedResponse
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.jwt.jwt
import io.ktor.server.response.respond
import org.slf4j.LoggerFactory
import java.net.URI
import java.security.interfaces.ECPublicKey
import java.util.Base64
import java.util.concurrent.TimeUnit

const val SESSION_AUTH = "session-jwt"

private val log = LoggerFactory.getLogger("Security")

private const val MILLIS_PER_SECOND = 1000L
private const val JWK_CACHE_SIZE = 10L
private const val JWK_CACHE_EXPIRY_HOURS = 24L
private const val JWK_RATE_LIMIT_BUCKET_SIZE = 10L
private const val JWK_RATE_LIMIT_REFILL_MINUTES = 1L
private const val PRIME_TIMEOUT_MS = 2000
private const val ES256_SIGNATURE_BYTES = 64

// Tolerance on `exp`, because our clock and the auth service's are never quite identical. Zero of
// it turned a host running 50s fast into a wall of `expired-token` 401s on tokens that were still
// valid. Bracketed by SecurityTest.
//
// Left at 5s through the move off Clerk, even though the constraint that set it has gone: a Clerk
// token lived 60s, so leeway ate a visible fraction of it. Ours live 15 minutes and the client asks
// for a fresh one a full minute before expiry (lib/session-token.ts), so a larger value here would
// only cover a gap that is already covered.
private const val CLOCK_LEEWAY_SECONDS = 5L

/**
 * What we check on a token beyond its signature, issuer and audience.
 *
 * Split out from the plugin so a test can exercise it without standing up an Application and a
 * JWKS endpoint. The audience is deliberately NOT in here: it is per-deployment config, and folding
 * it in would mean a unit test could not call this without inventing one.
 */
internal fun Verification.sessionClaims() {
    acceptLeeway(CLOCK_LEEWAY_SECONDS)
}

/**
 * Every request carries a JWT from the auth service (see auth/), verified here against its JWKS.
 *
 * Verification is offline: the keys are fetched once and cached, and nothing on the request path
 * talks to the auth service. That is what makes the two independently deployable, and it is why
 * swapping the identity provider touched almost nothing on this side.
 */
fun Application.configureSecurity(
    jwksUrl: String = Env.authJwksUrl,
    issuer: String = Env.authIssuer,
    audience: String = Env.authAudience,
    // Only the boot warmup's loopback server passes its own. See RequestWarmup.kt.
    jwkProvider: JwkProvider =
        JwkProviderBuilder(URI(jwksUrl).toURL())
            .cached(JWK_CACHE_SIZE, JWK_CACHE_EXPIRY_HOURS, TimeUnit.HOURS)
            .rateLimited(JWK_RATE_LIMIT_BUCKET_SIZE, JWK_RATE_LIMIT_REFILL_MINUTES, TimeUnit.MINUTES)
            .build(),
): JwkProvider {
    install(Authentication) {
        jwt(SESSION_AUTH) {
            // Issuer and audience both, not just the signature. A signature alone says the auth
            // service minted it, not that it minted it for this API.
            verifier(jwkProvider, issuer) {
                withAudience(audience)
                sessionClaims()
            }
            validate { credential ->
                // `sub` is the auth service's user id, which is what Users.id is keyed on.
                if (credential.payload.subject != null) {
                    JWTPrincipal(credential.payload)
                } else {
                    null
                }
            }
            // Same 401 as the default challenge, plus the reason on the request's log line. See
            // AuthFailure.kt: which kind of 401 it is decides whose bug it is.
            challenge { scheme, realm ->
                call.failing(
                    authFailureReason(
                        call.request.headers[HttpHeaders.Authorization],
                        System.currentTimeMillis() / MILLIS_PER_SECOND,
                    ),
                )
                call.respond(
                    UnauthorizedResponse(
                        HttpAuthHeader.Parameterized(scheme, mapOf(HttpAuthHeader.Parameters.Realm to realm)),
                    ),
                )
            }
        }
    }
    return jwkProvider
}

/**
 * Fetch the signing keys and run one verification at boot, so the first request does not.
 *
 * A freshly booted replica answered its first authenticated request in ~110ms against ~12ms warm,
 * locally on 2 cores (2026-10-15), and that cost lands on every read a page sends at once. Never
 * fatal: a replica that cannot reach the auth service yet fetches the keys on first use, as before.
 */
fun primeSigningKeys(
    jwkProvider: JwkProvider,
    jwksUrl: String = Env.authJwksUrl,
) {
    runCatching {
        val keys = UrlJwkProvider(URI(jwksUrl).toURL(), PRIME_TIMEOUT_MS, PRIME_TIMEOUT_MS).all
        for (key in keys) {
            val publicKey = jwkProvider.get(key.id).publicKey as? ECPublicKey ?: continue
            // A signature that cannot match. Checking it is the point, so the failure is expected.
            val unsigned = JWT.create().withKeyId(key.id).sign(Algorithm.none())
            val signature = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(ES256_SIGNATURE_BYTES))
            val forged = unsigned + signature
            runCatching { Algorithm.ECDSA256(publicKey, null).verify(JWT.decode(forged)) }
        }
    }.onFailure { log.warn("Signing keys not primed, the first request will fetch them", it) }
}
