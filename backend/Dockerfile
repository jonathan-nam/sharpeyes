# syntax=docker/dockerfile:1
#
# Built from the REPO ROOT (context: ., file: backend/Dockerfile), because the backend's build reads
# what sits beside it: the shared money module (includeBuild), the version catalog and the detekt
# config. backend/Dockerfile.dockerignore keeps the context to those. The layout under /app mirrors
# the repo's, so the relative paths in settings.gradle.kts hold.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app/backend

COPY gradle/libs.versions.toml /app/gradle/libs.versions.toml
COPY config /app/config
COPY backend/gradlew backend/gradlew.bat backend/build.gradle.kts backend/settings.gradle.kts backend/gradle.properties ./
COPY backend/gradle ./gradle
RUN chmod +x gradlew && ./gradlew --version

COPY shared/money /app/shared/money
COPY backend/src ./src

# installDist, not buildFatJar. The fat jar shades every dependency into one
# archive, and duplicate META-INF/services files get overwritten rather than
# concatenated -- so Flyway shipped with an empty plugin registry and the app
# died on boot with "Unknown prefix for location (should be one of ):", an empty
# list, because every provider had been clobbered. shadow's mergeServiceFiles()
# did not fix it (the transformer is applied and still drops flyway-core's 29
# providers down to the 3 from flyway-database-postgresql).
#
# The distribution keeps each dependency as its own jar on the classpath, so
# service files are never merged and never lost. It is also the shape Gradle's
# `application` plugin is built around.
#
# This only ever bit the deployed artifact: tests run on an unshaded classpath
# and passed the whole time. scripts/smoke.sh is what caught it, by booting the
# container a deploy would actually run.
RUN ./gradlew installDist --no-daemon

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN useradd --system --create-home appuser
COPY --from=build /app/backend/build/install/sharpeyes-backend ./
USER appuser

EXPOSE 8080
ENTRYPOINT ["./bin/sharpeyes-backend"]
