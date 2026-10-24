rootProject.name = "sharpeyes-backend"

// The shared money arithmetic, its own Kotlin Multiplatform build. The dependency on
// "com.sharpeyes:money" in build.gradle.kts resolves to it. See shared/money/build.gradle.kts.
includeBuild("../shared/money")

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
