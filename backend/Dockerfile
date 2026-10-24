# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

COPY gradlew gradlew.bat build.gradle.kts settings.gradle.kts gradle.properties detekt.yml ./
COPY gradle ./gradle
RUN chmod +x gradlew && ./gradlew --version

COPY src ./src
# Every project settings.gradle.kts includes, or :installDist cannot resolve it.
COPY money ./money

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
COPY --from=build /app/build/install/sharpeyes-backend ./
USER appuser

EXPOSE 8080
ENTRYPOINT ["./bin/sharpeyes-backend"]
