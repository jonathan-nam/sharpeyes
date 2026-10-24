package com.sharpeyes.backend.money

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Whole Drop Log figures, page in and figures out, against the TypeScript's own answers. The invented
 * accounts in the repo; an audit's real pages through MONEY_GOLDEN_DIR, one entry-*.json per page.
 */
class EntryGoldenTest {
    private fun entryFiles(): List<String> {
        val dir = System.getenv("MONEY_GOLDEN_DIR")
        if (dir != null) return File(dir).listFiles { f -> f.name.startsWith("entry-") }!!.map { it.readText() }
        return listOfNotNull(
            EntryGoldenTest::class.java
                .getResourceAsStream(
                    "/money-golden/entry-settlement.json",
                )?.bufferedReader()
                ?.readText(),
        )
    }

    private fun cases(): List<Pair<JsonElement, JsonElement>> =
        entryFiles().flatMap { text ->
            moneyJson.parseToJsonElement(text).jsonObject["cases"]!!.jsonArray.map {
                it.jsonObject["input"]!! to it.jsonObject["output"]!!
            }
        }

    @Test
    fun `agrees with the TypeScript on every recorded page`() {
        val cases = cases()
        assertTrue(cases.isNotEmpty(), "no entry fixtures")
        val wrong =
            cases.mapIndexedNotNull { i, (input, expected) ->
                val page: DropLogPage = moneyJson.decodeFromJsonElement(input.jsonObject["page"]!!)
                val books: List<SharedBook> = moneyJson.decodeFromJsonElement(input.jsonObject["books"]!!)
                val actual = out(dropLogFigures(page, books))
                firstDifference(expected, actual)?.let { "page #$i: $it" }
            }
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} of ${cases.size} pages disagree")
    }

    private companion object {
        const val SHOWN = 3
    }
}
