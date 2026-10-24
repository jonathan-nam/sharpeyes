package com.sharpeyes.backend

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// CI never builds the image, so a project missing from the Dockerfile passes every check and fails
// only in publish-images.yml after the merge, which is how :money first shipped.
class DockerfileProjectsTest {
    @Test
    fun `the image copies every project the build includes`() {
        val included =
            Regex("""include\("\s*:([\w-]+)"\)""")
                .findAll(File("settings.gradle.kts").readText())
                .map { it.groupValues[1] }
                .toList()
        assertTrue(included.isNotEmpty(), "no include() found in settings.gradle.kts")
        val copied = Regex("""^COPY (\S+) """, RegexOption.MULTILINE).findAll(File("Dockerfile").readText())
        val sources = copied.map { it.groupValues[1].trimEnd('/') }.toSet()
        assertEquals(emptyList(), included.filter { it !in sources }, "projects the Dockerfile does not COPY")
    }
}
