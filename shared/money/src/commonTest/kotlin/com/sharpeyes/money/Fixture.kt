package com.sharpeyes.money

// Where the golden fixtures come from, the one thing the tests cannot say in common code: each target
// reads files its own way. The JVM's is Fixture.jvm.kt.

/** A golden fixture, read only when asked: an audit's are too many to hold in memory together. */
internal class Fixture(
    val name: String,
    private val read: () -> String,
) {
    fun text(): String = read()
}

/** The fixtures whose names start with [prefix] and end in .json, by name: the repo's, or an audit's. */
internal expect fun goldenFixtures(prefix: String): List<Fixture>

/** One fixture's text by [name], or null when there is none. */
internal expect fun goldenFixture(name: String): String?
