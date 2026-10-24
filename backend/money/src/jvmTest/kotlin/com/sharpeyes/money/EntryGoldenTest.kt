package com.sharpeyes.money

import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Whole Drop Log figures, page in and figures out, against the TypeScript's own answers: the invented
 * accounts in the repo, or an audit's real pages through MONEY_GOLDEN_DIR. One file at a time, since an
 * audit's do not fit in memory together.
 */
class EntryGoldenTest {
    /** Each disagreement in one file, named by the file and the case. */
    private fun disagreements(file: File): List<String> =
        moneyJson.parseToJsonElement(file.readText()).jsonObject["cases"]!!.jsonArray.mapIndexedNotNull { i, case ->
            val input = case.jsonObject["input"]!!.jsonObject
            val page: DropLogPage = moneyJson.decodeFromJsonElement(input["page"]!!)
            val books: List<SharedBook> = moneyJson.decodeFromJsonElement(input["books"]!!)
            val actual = out(dropLogFigures(page, books))
            firstDifference(case.jsonObject["output"], actual)?.let { "${file.name} #$i: $it" }
        }

    @Test
    fun `agrees with the TypeScript on every recorded page`() {
        val files = goldenFiles("entry-")
        assertTrue(files.isNotEmpty(), "no entry fixtures")
        val wrong = files.flatMap(::disagreements)
        assertEquals(emptyList(), wrong.take(SHOWN), "${wrong.size} disagreements over ${files.size} files")
    }

    private companion object {
        const val SHOWN = 3
    }
}
