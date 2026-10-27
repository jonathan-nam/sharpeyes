package com.sharpeyes.planning

// The fixtures are commonTest resources, on the test classpath.
internal actual fun goldenFixture(name: String): String? =
    GoldenCase::class.java
        .getResourceAsStream("/planning-golden/$name")
        ?.bufferedReader()
        ?.use { it.readText() }
