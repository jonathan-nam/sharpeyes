// The money arithmetic, shared: the backend runs it on the JVM, and the Android and iOS apps are to add
// their own targets to this same module. Common code only in commonMain; a platform reaches it through
// an expect/actual (see Collation.kt). See docs/backend-arithmetic-plan.md.

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("org.jlleitschuh.gradle.ktlint")
    id("io.gitlab.arturbosch.detekt")
}

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(21)
    jvm()

    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")
        }
        jvmMain.dependencies {
            // localeCompare's ICU collation on the JVM. Android has the same in android.icu.
            implementation("com.ibm.icu:icu4j:77.1")
        }
        jvmTest.dependencies {
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
    config.setFrom(files("$rootDir/detekt.yml"))
    source.setFrom("src/commonMain/kotlin", "src/jvmMain/kotlin", "src/jvmTest/kotlin")
}

ktlint {
    version.set("1.3.1")
}

dependencies {
    detektPlugins("io.gitlab.arturbosch.detekt:detekt-formatting:1.23.7")
}
