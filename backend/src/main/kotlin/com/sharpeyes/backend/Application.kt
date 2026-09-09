package com.sharpeyes.backend

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.plugins.configureCompression
import com.sharpeyes.backend.plugins.configureCors
import com.sharpeyes.backend.plugins.configureDatabase
import com.sharpeyes.backend.plugins.configureRouting
import com.sharpeyes.backend.plugins.configureSecurity
import com.sharpeyes.backend.plugins.configureSerialization
import com.sharpeyes.backend.plugins.configureTiming
import com.sharpeyes.backend.plugins.warmReadPaths
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.services.VisionServiceClient
import com.sharpeyes.backend.services.createNexonHttpClient
import com.sharpeyes.backend.services.createVisionHttpClient
import com.sharpeyes.backend.sprites.SpriteCache
import com.sharpeyes.backend.sprites.SpriteRefreshJob
import com.sharpeyes.backend.sprites.startSpriteRefresh
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty

fun main() {
    // 8080 unless PORT says otherwise. The box's second replica sets 8081, and so does a branch
    // run beside the already-running dev stack to look at it.
    embeddedServer(Netty, port = Env.port, host = "0.0.0.0", module = Application::module)
        .start(wait = true)
}

fun Application.module() {
    configureTiming()
    configureSerialization()
    configureCompression()
    configureCors()
    configureSecurity()
    configureDatabase()

    val nexonHttpClient = createNexonHttpClient()
    monitor.subscribe(ApplicationStopped) { nexonHttpClient.close() }

    // Screenshots are parsed by the OpenCV vision service: no third-party call, no metering,
    // and the same answer every time for the same bytes.
    val visionHttpClient = createVisionHttpClient()
    monitor.subscribe(ApplicationStopped) { visionHttpClient.close() }
    val screenshotParser = VisionServiceClient(visionHttpClient, Env.visionServiceUrl)

    // Shares the Nexon client: same third party, and one connection pool rather than two. The JSON
    // negotiation installed on it is irrelevant to fetching bytes.
    val nexonLookupService = NexonLookupService(nexonHttpClient)
    val spriteCache = SpriteCache(nexonHttpClient)

    configureRouting(nexonLookupService, screenshotParser, spriteCache)

    // Before /health can answer, so a restarted replica warms on the deploy's time rather than the
    // next visitor's. See Warmup.kt for the measurement.
    warmReadPaths()

    // An outfit is the player's to change and nothing tells us when they have, so the sprite URL is
    // re-asked for on a clock. See SpriteRefreshJob.
    startSpriteRefresh(SpriteRefreshJob(nexonLookupService, spriteCache))
}
