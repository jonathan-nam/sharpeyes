package com.maplestorage.backend.config

private const val DEFAULT_VISION_SERVICE_URL = "http://127.0.0.1:8000"
private const val DEFAULT_PORT = 8080

// Central place to read the environment variables the ECS task definition
// injects (see infra/ecs.tf's `environment`/`secrets` blocks). Fail fast at
// startup if one is missing rather than surfacing a null deep in a request.
object Env {
    val dbHost: String get() = required("DB_HOST")
    val dbPort: String get() = required("DB_PORT")
    val dbName: String get() = required("DB_NAME")
    val dbUsername: String get() = required("DB_USERNAME")
    val dbPassword: String get() = required("DB_PASSWORD")

    // Where the auth service publishes its public signing keys, and the two claims a token has to
    // carry to be one of ours. All three, because a token that verifies against the right keys but
    // was issued for something else is still not a token for this API.
    val authJwksUrl: String get() = required("AUTH_JWKS_URL")
    val authIssuer: String get() = required("AUTH_ISSUER")
    val authAudience: String get() = required("AUTH_AUDIENCE")

    val frontendOrigin: String get() = required("FRONTEND_ORIGIN")

    // The vision service runs as a second container in the same ECS task, so
    // this is loopback by default and only needs overriding for local dev.
    val visionServiceUrl: String get() = System.getenv("VISION_SERVICE_URL") ?: DEFAULT_VISION_SERVICE_URL

    // Deployed on 8080 everywhere (infra/ecs.tf and docker-compose.yml both publish it). Only a
    // second local instance, run beside the dev stack to look at a branch, needs another.
    val port: Int get() = System.getenv("PORT")?.toIntOrNull() ?: DEFAULT_PORT

    private fun required(name: String): String =
        System.getenv(name) ?: error("Missing required environment variable: $name")
}
