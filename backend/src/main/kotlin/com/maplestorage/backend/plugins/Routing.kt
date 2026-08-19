package com.maplestorage.backend.plugins

import com.maplestorage.backend.bosses.bossRoutes
import com.maplestorage.backend.characters.characterRoutes
import com.maplestorage.backend.parties.partyRoutes
import com.maplestorage.backend.parties.peopleRoutes
import com.maplestorage.backend.parties.vestigeLedgerRoutes
import com.maplestorage.backend.screenshots.screenshotRoutes
import com.maplestorage.backend.services.NexonLookupService
import com.maplestorage.backend.services.ScreenshotParser
import com.maplestorage.backend.sprites.SpriteCache
import com.maplestorage.backend.sprites.spriteRoutes
import com.maplestorage.backend.tokens.tokenRoutes
import com.maplestorage.backend.users.settingsRoutes
import io.ktor.http.CacheControl
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.http.content.staticResources
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

fun Application.configureRouting(
    nexonLookupService: NexonLookupService,
    screenshotParser: ScreenshotParser,
    spriteCache: SpriteCache,
) {
    routing {
        // A day, and public: these are static art keyed by a stable filename, so without it the
        // browser refetched every icon on each inventory switch, which showed as the grid filling
        // in a beat after the character did. The filenames are not content-hashed, so an icon that
        // changes on deploy is picked up within the day (or on a hard refresh), which is the right
        // trade for art that changes rarely.
        val iconCache = { _: java.net.URL ->
            listOf(CacheControl.MaxAge(maxAgeSeconds = 86_400, visibility = CacheControl.Visibility.Public))
        }

        // Token icons are the seeded catalog images (token_catalog.icon_ref_key
        // is the bare filename). Public on purpose. They're static art, and
        // the <img> tags that load them can't attach a Bearer token.
        staticResources("/token-icons", "seed-assets/tokens") { cacheControl(iconCache) }

        // The stack-count digits as the CLIENT draws them: an 11px bitmap face with a hard black
        // outline that no web font matches, so the inventory renders counts from these sprites
        // rather than styling a number (an approximation sits next to the real thing and looks like
        // one). Hand-maintained PNGs. They began as a recolour of the parser's matching templates
        // (vision/app/cv/templates/digit_*.png), the same face, but have since been hand-tuned and
        // are no longer identical to them. Ground truth for a glyph's shape is the client itself,
        // in test-fixtures/inventory/untradeables sample.png: hand-tuning once removed
        // background bleed by grey value and took the real fill with it, because the fill
        // fades to 195 at the baseline and the slot background is 226.
        staticResources("/digit-icons", "seed-assets/digits") { cacheControl(iconCache) }

        // Boss drop art, from catalog/drops.yaml. Public and cached like the token icons, and for
        // the same reasons: static art keyed by a stable filename, loaded by <img> tags that
        // cannot attach a Bearer token.
        staticResources("/drop-icons", "seed-assets/drops") { cacheControl(iconCache) }

        // Boss portraits, cut from a planner capture. Public and cached like the other art.
        staticResources("/boss-icons", "seed-assets/bosses") { cacheControl(iconCache) }

        // Character sprites, proxied from Nexon. Not staticResources: these are fetched at runtime
        // and live in the database, not in the jar. Public for the same reason as the art above.
        spriteRoutes()

        // Unauthenticated on purpose, this is what the ALB target group polls
        // (see infra/alb.tf's health_check block). No DB touch here: a slow or
        // briefly-unavailable RDS shouldn't flip the target group unhealthy.
        get("/health") {
            call.respond(mapOf("status" to "ok"))
        }

        // Real User Monitoring: browsers beacon their page-load metrics here. Unauthenticated
        // on purpose, it is a fire-and-forget sendBeacon that carries no credentials and no PII.
        route("/api/vitals") {
            vitalsRoutes()
        }

        // M0's actual round-trip proof: a signed-in user's JWT verifies against
        // the auth service's JWKS, and the response value comes from a real RDS query, not
        // a hardcoded string.
        authenticate(SESSION_AUTH) {
            get("/api/ping") {
                val principal = call.principal<JWTPrincipal>()
                val userId = principal!!.payload.subject

                val dbTimestamp =
                    transaction {
                        exec("SELECT NOW()") { rows ->
                            rows.next()
                            rows.getString(1)
                        }
                    }

                call.respond(PingResponse(userId = userId, dbTimestamp = dbTimestamp ?: "unknown"))
            }

            route("/api/characters") {
                characterRoutes(nexonLookupService, spriteCache)
            }

            route("/api/screenshots") {
                screenshotRoutes(screenshotParser)
            }

            route("/api/tokens") {
                tokenRoutes()
            }

            route("/api/bosses") {
                bossRoutes()
            }

            route("/api/parties") {
                partyRoutes(nexonLookupService, spriteCache)
            }

            route("/api/people") {
                peopleRoutes()
            }

            // Three paths, one feature, mounted together. See vestigeLedgerRoutes.
            vestigeLedgerRoutes()

            route("/api/settings") {
                settingsRoutes()
            }
        }
    }
}
