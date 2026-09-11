package com.sharpeyes.backend.plugins

import com.sharpeyes.backend.bosses.bossRoutes
import com.sharpeyes.backend.characters.characterRoutes
import com.sharpeyes.backend.invites.inviteRoutes
import com.sharpeyes.backend.invites.joinRoutes
import com.sharpeyes.backend.pages.pageRoutes
import com.sharpeyes.backend.parties.partyRoutes
import com.sharpeyes.backend.parties.peopleRoutes
import com.sharpeyes.backend.parties.vestigeLedgerRoutes
import com.sharpeyes.backend.screenshots.screenshotRoutes
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.services.ScreenshotParser
import com.sharpeyes.backend.sprites.SpriteCache
import com.sharpeyes.backend.sprites.spriteRoutes
import com.sharpeyes.backend.tokens.tokenRoutes
import com.sharpeyes.backend.users.settingsRoutes
import io.ktor.http.CacheControl
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.http.content.staticResources
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing

/**
 * The two endpoints a browser talks to with no credentials at all.
 *
 * Both are fire-and-forget sendBeacon targets carrying no PII, and the second has to work when
 * authentication is exactly what broke. Lifted out of configureRouting because they are one idea
 * and it was three route blocks long without them.
 */
private fun Route.beaconRoutes() {
    // Real User Monitoring: browsers beacon their page-load metrics here.
    route("/api/vitals") {
        vitalsRoutes()
    }

    // What the browser saw.
    route("/api/errors") {
        clientErrorRoutes()
    }
}

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

        healthRoutes()

        beaconRoutes()

        // What a sign-on link offers, to somebody who has no account yet. See joinRoutes.
        joinRoutes()

        // M0's actual round-trip proof: a signed-in user's JWT verifies against
        // the auth service's JWKS, and the response value comes from a real database query, not
        // a hardcoded string.
        authenticate(SESSION_AUTH) {
            get("/api/ping") {
                val principal = call.principal<JWTPrincipal>()
                val userId = principal!!.payload.subject

                val dbTimestamp =
                    dbQuery {
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

            // A whole screen's reads in one request, for the pages heavy enough that the
            // per-request cost of the individual endpoints is what they are waiting on. The
            // resources underneath stay; see pages/DropLogPageRoutes.kt.
            route("/api/pages") {
                pageRoutes()
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

            route("/api/invites") {
                inviteRoutes(nexonLookupService, spriteCache)
            }
        }
    }
}
