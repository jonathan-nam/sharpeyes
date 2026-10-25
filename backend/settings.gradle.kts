rootProject.name = "sharpeyes-backend"

// The shared money arithmetic, its own Kotlin Multiplatform build. The dependency on
// "com.sharpeyes:money" in build.gradle.kts resolves to it. See shared/money/build.gradle.kts.
includeBuild("../shared/money")

// The HTTP API's types, shared with every client. "com.sharpeyes:api" resolves to it. See
// shared/api/build.gradle.kts.
includeBuild("../shared/api")

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}
