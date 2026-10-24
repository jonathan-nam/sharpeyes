package com.sharpeyes.backend.money

import kotlin.test.Test
import kotlin.test.assertEquals

class CollationGoldenTest {
    @Test
    fun `orders every recorded pair as the browser's localeCompare does`() {
        val file = golden<List<String>, Int>("collation.json")
        val wrong =
            file.cases.filter { localeCompare(it.input[0], it.input[1]) != it.output }.map {
                "${it.input} expected ${it.output} got ${localeCompare(it.input[0], it.input[1])}"
            }
        assertEquals(emptyList(), wrong.take(10), "${wrong.size} of ${file.cases.size} pairs disagree")
    }
}
