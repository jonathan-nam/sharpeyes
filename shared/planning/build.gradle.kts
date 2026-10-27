// Run Order's planning, shared: ported from frontend/lib/boss-run-plan.ts, boss-night.ts and
// night-search.ts for the Android and iOS apps,
// which are to add their own targets to this module. Common code only in commonMain; a platform reaches
// it through an expect/actual (see Collation.kt), and the tests are common too, so every target runs the
// goldens. See docs/shared-modules-plan.md.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

group = "com.sharpeyes"

kotlin {
    // On the jvm target alone rather than a module-wide jvmToolchain, which an Android target would
    // inherit against its own Java level.
    jvm {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_21)
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
            // Public, because nightOf and runsFromParties take its PartyResponse and BossResponse.
            api("com.sharpeyes:api")
        }
        jvmMain.dependencies {
            // localeCompare's ICU collation on the JVM. Android has the same in android.icu.
            implementation(libs.icu4j)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

tasks.named<Test>("jvmTest") {
    useJUnitPlatform()
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("$rootDir/../../config/detekt/detekt.yml"))
    // Every source set, so one a new target adds is linted without being listed here.
    source.setFrom(kotlin.sourceSets.map { it.kotlin.sourceDirectories })
}

ktlint {
    version.set(libs.versions.ktlint.tool)
}

dependencies {
    detektPlugins(libs.detekt.formatting)
}
