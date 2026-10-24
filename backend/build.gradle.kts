// Versions live in ../gradle/libs.versions.toml, shared with shared/money.

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktor)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

group = "com.sharpeyes"
version = "0.1.0"

application {
    mainClass.set("com.sharpeyes.backend.ApplicationKt")
}

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.server.auth)
    implementation(libs.ktor.server.auth.jwt)
    implementation(libs.jwks.rsa) // JWKS fetch/cache. ECDSA only, no EdDSA: see SessionJwtTest
    implementation(libs.ktor.server.call.logging)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.server.compression)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.cio)
    implementation(libs.ktor.client.content.negotiation)

    implementation(libs.kotlinx.serialization.json)

    // The shared money module, substituted from ../shared/money by settings.gradle.kts.
    implementation("com.sharpeyes:money")

    implementation(libs.exposed.core)
    implementation(libs.exposed.jdbc)
    implementation(libs.exposed.kotlin.datetime)
    implementation(libs.exposed.json)
    implementation(libs.postgresql)
    implementation(libs.hikaricp)

    implementation(libs.flyway.core)
    implementation(libs.flyway.database.postgresql)

    implementation(libs.logback.classic)

    detektPlugins(libs.detekt.formatting)

    testImplementation(libs.ktor.server.test.host)
    testImplementation(libs.ktor.client.mock)
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(21)
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("$rootDir/../config/detekt/detekt.yml"))
}

ktlint {
    version.set(libs.versions.ktlint.tool)
}

// The money build is included, not a subproject, so its checks run only when asked for by name. These
// keep CI's `./gradlew ktlintCheck detekt test` and the pre-commit hook covering it.
val money = gradle.includedBuild("money")

tasks.test {
    useJUnitPlatform()
    dependsOn(money.task(":jvmTest"))
}

tasks.named("ktlintCheck") { dependsOn(money.task(":ktlintCheck")) }

tasks.named("detekt") { dependsOn(money.task(":detekt")) }
