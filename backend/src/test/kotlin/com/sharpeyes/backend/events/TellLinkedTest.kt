package com.sharpeyes.backend.events

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Who was linked BEFORE a write is read once the caller is known. Read in onCall it was always
 * nobody, which no write but an unlink noticed: the accounts linked after it still heard everything,
 * and an unlink, which takes its account off that list, told nobody (found 2026-10-21).
 */
class TellLinkedTest {
    private val source = File("src/main/kotlin/com/sharpeyes/backend/events/TellLinked.kt").readText()

    @Test
    fun `the links before a write are read after authentication`() {
        assertTrue(source.contains("on(AuthenticationChecked)"))
        assertFalse(Regex("""onCall \{""").containsMatchIn(source))
    }
}
