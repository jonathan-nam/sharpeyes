// What the backend serves and accepts, as types: one definition the server encodes and every client
// decodes, so the shape is written once. Common code only, plain @Serializable data. See
// docs/shared-modules-plan.md.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

// What the backend depends on ("com.sharpeyes:api"), which includeBuild substitutes with this build.
group = "com.sharpeyes"

kotlin {
    // On the jvm target alone, as in shared/money: an Android target would inherit a module-wide one.
    jvm {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_21)
        }
    }

    sourceSets {
        commonMain.dependencies {
            api(libs.kotlinx.serialization.json)
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
    source.setFrom(kotlin.sourceSets.map { it.kotlin.sourceDirectories })
}

ktlint {
    version.set(libs.versions.ktlint.tool)
}

dependencies {
    detektPlugins(libs.detekt.formatting)
}
