package com.sharpeyes.backend.bosses

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Every clear writer ends in clearChanged, never in syncPiecesForClear directly: one that did would
 * still sync the pieces and silently stop copying clears to the party (ClearWriteThrough.kt).
 */
class ClearChangedCallersTest {
    @Test
    fun `nothing calls syncPiecesForClear but clearChanged`() {
        val callers =
            File("src/main/kotlin")
                .walk()
                .filter { it.isFile && it.extension == "kt" }
                .filter { file ->
                    file.readLines().any { "syncPiecesForClear(" in it && "fun syncPiecesForClear" !in it }
                }.map { it.name }
                .toList()
        assertEquals(listOf("ClearWriteThrough.kt"), callers)
    }
}
