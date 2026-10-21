package com.sharpeyes.backend.plugins

import io.ktor.http.ContentType
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.compression.Compression
import io.ktor.server.plugins.compression.deflate
import io.ktor.server.plugins.compression.excludeContentType
import io.ktor.server.plugins.compression.gzip
import io.ktor.server.plugins.compression.minimumSize

// Bodies below this are not worth a compression frame's overhead.
private const val MIN_COMPRESS_BYTES = 1024L

// Gzip the JSON responses. The bulk /api/characters/tokens payload (every character x all their
// tokens) is the largest thing this server sends and it went out uncompressed. This is
// transport-only: the token counts are byte-for-byte unchanged once decoded, so it cannot affect
// a count. Images are already compressed, so they are excluded rather than spend CPU repacking
// PNGs.
fun Application.configureCompression() {
    install(Compression) {
        gzip()
        deflate()
        minimumSize(MIN_COMPRESS_BYTES)
        excludeContentType(ContentType.Image.Any)
        // A live event stream: gzip holds bytes back until a frame fills, so no event would arrive.
        excludeContentType(ContentType.Text.EventStream)
    }
}
