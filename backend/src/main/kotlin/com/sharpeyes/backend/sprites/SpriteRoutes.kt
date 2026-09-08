package com.sharpeyes.backend.sprites

import com.sharpeyes.backend.plugins.dbQuery
import io.ktor.http.CacheControl
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondRedirect
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

// A year, and immutable. Safe in a way the seeded icons are not: the key is a hash of the URL and
// the URL encodes the outfit, so these bytes cannot change under their path. A new outfit is a new
// URL, a new key, and a new path.
private const val SPRITE_MAX_AGE = 365L * 24 * 60 * 60

/**
 * Serves the bytes behind a character sprite.
 *
 * Public, like the seeded icons and for the same reason: an `<img>` tag cannot attach a Bearer
 * token. It leaks nothing that was not already public, the bytes are game art Nexon serves
 * unauthenticated, and reaching a row means producing the sha256 of its URL.
 */
fun Route.spriteRoutes() {
    get("$SPRITE_PROXY_PREFIX/{key}") {
        val key = spriteKeyFromSegment(call.parameters["key"].orEmpty())
        if (key == null) {
            call.respond(HttpStatusCode.NotFound)
            return@get
        }

        val cached = dbQuery { cachedSprite(key) }
        when {
            cached == null -> call.respond(HttpStatusCode.NotFound)
            cached.image != null -> {
                call.response.header(HttpHeaders.CacheControl, "public, max-age=$SPRITE_MAX_AGE, immutable")
                call.respondBytes(cached.image, ContentType.Image.PNG)
            }
            // Known URL, no bytes yet. Hand the browser straight to Nexon, which is what it did
            // before this route existed, so a failed warm costs the caching and never the image.
            // no-store, or the redirect itself would be cached and the warm that lands a minute
            // later would never be seen.
            else -> {
                call.response.header(HttpHeaders.CacheControl, CacheControl.NoStore(null).toString())
                call.respondRedirect(cached.sourceUrl)
            }
        }
    }
}
