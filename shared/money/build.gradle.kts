// The money arithmetic, shared: the backend runs it on the JVM, and the Android and iOS apps are to add
// their own targets to this same module. Common code only in commonMain; a platform reaches it through
// an expect/actual (see Collation.kt), and the tests are common too, so every target runs the goldens.
// See docs/backend-arithmetic-plan.md.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

// What the backend depends on ("com.sharpeyes:money"), which includeBuild substitutes with this build.
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
    // An audit replays fixtures recorded from real pages, hundreds of megabytes of them
    // (MONEY_GOLDEN_DIR). -PtestHeap=6g; the default is Gradle's.
    maxHeapSize = providers.gradleProperty("testHeap").getOrElse("512m")
    // MONEY_GOLDEN_DIR changes what the tests read, so a run with it is never up to date.
    inputs.property("goldenDir", providers.environmentVariable("MONEY_GOLDEN_DIR").orElse(""))
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
