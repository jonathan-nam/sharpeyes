// The shared money arithmetic, its own Gradle build so every app includes it the same way: the backend
// with includeBuild("../shared/money") today, the Android and iOS apps once they exist. See
// build.gradle.kts.
rootProject.name = "money"

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
