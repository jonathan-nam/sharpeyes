// The shared planning logic, its own Gradle build like shared/money. The backend includes it so CI runs
// its checks; the Android and iOS apps are to include it the same way. See build.gradle.kts.
rootProject.name = "planning"

// The party and boss bodies a night is built from. "com.sharpeyes:api" resolves to it.
includeBuild("../api")

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
    versionCatalogs {
        create("libs") {
            from(files("../../gradle/libs.versions.toml"))
        }
    }
}
