package com.sharpeyes.backend

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// A build or project the backend includes that the Dockerfile does not COPY fails only when the image
// is built, which is how :money first shipped. CI's backend-image job builds it now; this names the
// missing line in a second, on any machine.
class DockerfileProjectsTest {
    @Test
    fun `the image copies every build and project the backend includes`() {
        val settings = File("settings.gradle.kts").readText()
        // As paths from the repo root, which is the image's build context.
        val builds = Regex("""includeBuild\("\.\./([^"]+)"\)""").findAll(settings).map { it.groupValues[1] }
        val projects = Regex("""include\("\s*:([\w-]+)"\)""").findAll(settings).map { "backend/${it.groupValues[1]}" }
        val needed = (builds + projects).toList()
        assertTrue(needed.isNotEmpty(), "no include() or includeBuild() found in settings.gradle.kts")
        val copied = Regex("""^COPY (\S+) """, RegexOption.MULTILINE).findAll(File("Dockerfile").readText())
        val sources = copied.map { it.groupValues[1].trimEnd('/') }.toSet()
        assertEquals(emptyList(), needed.filter { it !in sources }, "builds the Dockerfile does not COPY")
    }
}
