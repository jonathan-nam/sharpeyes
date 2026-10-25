package com.sharpeyes.api

import kotlinx.serialization.json.Json

/**
 * How the API is written and read. The server encodes every response with it, and a client decoding
 * with the same settings reads exactly what was sent: unknown fields ignored, so an older client
 * survives a newer server, and every default written out, so a field is never absent because it held
 * its default.
 */
val apiJson =
    Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
