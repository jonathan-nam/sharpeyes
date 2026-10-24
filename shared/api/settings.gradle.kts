// The HTTP API's types, its own Gradle build so every client includes it the same way: the backend
// with includeBuild("../shared/api") today, the Android and iOS apps once they exist. See
// build.gradle.kts.
rootProject.name = "api"

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
