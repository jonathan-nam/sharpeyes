package com.sharpeyes.api

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GeneratedTypesTest {
    // Relative to shared/api, which Gradle runs this module's tests from.
    private val file = File("../../frontend/types/generated/api.ts")

    @Test
    fun `the frontend's generated types are what shared api serves`() {
        val rendered = TypeScript.render(TypeScript.roots())
        if (System.getenv("UPDATE_API_TYPES") == "1") {
            file.parentFile.mkdirs()
            file.writeText(rendered)
        }
        assertEquals(
            rendered,
            file.readText(),
            "frontend/types/generated/api.ts is stale. " +
                "Run UPDATE_API_TYPES=1 ./gradlew -p ../shared/api jvmTest from backend/.",
        )
    }

    @Test
    fun `every body is found`() {
        // A scan that found nothing would render an empty file and pass the test above against it.
        val names = TypeScript.roots().map { it.serialName.substringAfterLast('.') }
        assertTrue("PartyResponse" in names && "BulkSaleRequest" in names && "LiveData" in names, "$names")
    }
}
