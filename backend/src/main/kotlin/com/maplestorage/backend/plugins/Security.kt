package com.maplestorage.backend.plugins

import com.auth0.jwk.JwkProviderBuilder
import com.maplestorage.backend.config.Env
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.auth.Authentication
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.jwt.jwt
import java.net.URI
import java.util.concurrent.TimeUnit

const val SESSION_AUTH = "session-jwt"

private const val JWK_CACHE_SIZE = 10L
private const val JWK_CACHE_EXPIRY_HOURS = 24L
private const val JWK_RATE_LIMIT_BUCKET_SIZE = 10L
private const val JWK_RATE_LIMIT_REFILL_MINUTES = 1L

/**
 * A few seconds of slack on `exp` and `nbf`.
 *
 * Without it a clock a second or two ahead of the auth service rejects a token it has only just
 * been handed, and the UI reports a write that landed as one that failed. It is a real recurring
 * bug under WSL2, whose clock drifts after the host sleeps.
 */
private const val CLOCK_LEEWAY_SECONDS = 30L

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
) {
    val jwksUri = URI(jwksUrl).toURL()
    val jwkProvider =
        JwkProviderBuilder(jwksUri)
            .cached(JWK_CACHE_SIZE, JWK_CACHE_EXPIRY_HOURS, TimeUnit.HOURS)
            .rateLimited(JWK_RATE_LIMIT_BUCKET_SIZE, JWK_RATE_LIMIT_REFILL_MINUTES, TimeUnit.MINUTES)
            .build()

    install(Authentication) {
        jwt(SESSION_AUTH) {
            verifier(jwkProvider, issuer) {
                // Both claims are checked. A signature alone only says the auth service minted it,
                // not that it minted it for this API.
                withAudience(audience)
                acceptLeeway(CLOCK_LEEWAY_SECONDS)
            }
            validate { credential ->
                // `sub` is the auth service's user id, which is what Users.id is keyed on.
                if (credential.payload.subject != null) {
                    JWTPrincipal(credential.payload)
                } else {
                    null
                }
            }
        }
    }
}
