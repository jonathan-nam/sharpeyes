package com.sharpeyes.money

import java.io.File

// The repo's fixtures are commonTest resources, on the test classpath. MONEY_GOLDEN_DIR reads an audit's
// from a directory instead: fixtures recorded from real data, which never belong in the repo.

private fun auditDir(): File? = System.getenv("MONEY_GOLDEN_DIR")?.let(::File)

private fun repoDir(): File = File(requireNotNull(Fixture::class.java.getResource("/money-golden")).toURI())

internal actual fun goldenFixtures(prefix: String): List<Fixture> =
    (auditDir() ?: repoDir())
        .listFiles { f -> f.name.startsWith(prefix) && f.name.endsWith(".json") }
        .orEmpty()
        .sortedBy { it.name }
        .map { file -> Fixture(file.name) { file.readText() } }

internal actual fun goldenFixture(name: String): String? =
    auditDir()?.let { File(it, name) }?.takeIf { it.exists() }?.readText()
        ?: Fixture::class.java
            .getResourceAsStream("/money-golden/$name")
            ?.bufferedReader()
            ?.use { it.readText() }
