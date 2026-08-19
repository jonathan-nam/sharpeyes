# backend

Ktor + Exposed + Flyway, running against Postgres.

Screenshots are parsed by the **vision service** (`../vision/`), which runs as a
second container in the same ECS task and is reached over `127.0.0.1`. See
`services/VisionServiceClient.kt`.

## Local dev

Postgres now comes from the repo-root compose file (the one that also runs the
vision service and the backend itself), so there is a single stack definition
rather than two that can drift apart:

```bash
# From the repo root, just the database, for running the backend from Gradle
docker compose up -d postgres

cd backend
cp .env.example .env      # works as-is against the local stack

# Export the vars into your shell, then run/test/build as usual, this covers
# ./gradlew run, ./gradlew test, and IDE debug launches uniformly, unlike a
# Gradle-only or direnv-only loader.
set -a && source .env && set +a

./gradlew run
```

On boot, `configureDatabase()` runs Flyway migrations automatically
(`src/main/resources/db/migration/`) before the app starts serving requests. No
separate migrate step needed.

To run **the whole stack** (backend + vision + Postgres) rather than just the
database, use the root compose file directly, or `../scripts/smoke.sh` to bring it
up and assert it actually works.

## Tests

`./gradlew test` expects the same `DB_*` env vars exported, against a real
Postgres (not a mock). Start it as above.

## A packaging note worth knowing

The Dockerfile ships the `application` plugin's **distribution**, not a fat jar.
Ktor's `buildFatJar` shades every dependency into one archive and overwrites
duplicate `META-INF/services` files instead of concatenating them, which silently
emptied Flyway's plugin registry and made the deployed image fail on boot
(`Unknown prefix for location (should be one of ):`). Tests never caught it: they
run on an unshaded classpath. Don't switch back to the fat jar.
