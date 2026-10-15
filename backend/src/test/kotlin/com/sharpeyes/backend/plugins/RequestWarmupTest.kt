package com.sharpeyes.backend.plugins

import com.auth0.jwk.SigningKeyNotFoundException
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

// The warmup signs its own token, so its key has to survive the trip through a JWK. A coordinate
// is 32 bytes, and BigInteger.toByteArray gives 33 for half of all keys and fewer for some, which
// is why this runs many keys rather than one.
class RequestWarmupTest {
    private val generator = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }

    @Test
    fun `a token signed with the warmup key verifies against the key it publishes`() {
        repeat(KEYS) {
            val pair = generator.generateKeyPair()
            val publicKey = pair.public as ECPublicKey
            val token =
                JWT
                    .create()
                    .withKeyId(WARMUP_KID)
                    .withSubject("user_1")
                    .sign(Algorithm.ECDSA256(publicKey, pair.private as ECPrivateKey))

            val published = onlyKey(publicKey).get(WARMUP_KID).publicKey as ECPublicKey

            assertEquals(publicKey.w, published.w)
            JWT.require(Algorithm.ECDSA256(published, null)).build().verify(token)
        }
    }

    @Test
    fun `the warmup server knows no other key`() {
        val publicKey = generator.generateKeyPair().public as ECPublicKey
        assertFailsWith<SigningKeyNotFoundException> { onlyKey(publicKey).get("anything-else") }
    }

    private companion object {
        const val KEYS = 200
    }
}
