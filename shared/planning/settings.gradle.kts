// The shared planning logic, its own Gradle build like shared/money. The backend includes it so CI runs
// its checks; the Android and iOS apps are to include it the same way. See build.gradle.kts.
rootProject.name = "planning"

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
