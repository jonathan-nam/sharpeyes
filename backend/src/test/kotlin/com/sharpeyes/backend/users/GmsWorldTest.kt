package com.sharpeyes.backend.users

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The world mapping, and the record of how it was verified.
 *
 * Not arithmetic, so there is nothing here a reader could not check by eye. What it pins is a set
 * of CLAIMS about a live third-party API that this codebase cannot re-derive at runtime, and which
 * were expensive to obtain: Nexon returns no world name, so each row was found by looking up a
 * character whose world its owner named and seeing which numeric id answered.
 *
 * Those four names are below. If GMS merges worlds and this file starts lying, they are how to
 * re-pin it: query the ranking endpoint for each name across every id and see which answers.
 *
 *     https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na
 *         ?type=world&id=<id>&page_index=1&character_name=<name>
 *
 * Deliberately NOT a live test. A unit test that hits nexon.com is a test that fails when their
 * site is slow, in a suite that gates every merge, and it would be measuring their uptime rather
 * than this mapping.
 */
class GmsWorldTest {
    /** Verified 2026-08-09, one character per world, each named by their owner. */
    private val verifiedAgainst =
        mapOf(
            "Bane" to GmsWorld.BERA,
            "tidelark" to GmsWorld.SCANIA,
            "Shapaz" to GmsWorld.KRONOS,
            "GigaTaco5" to GmsWorld.HYPERION,
        )

    @Test
    fun `every world has the id its verification found`() {
        assertEquals(1, GmsWorld.BERA.worldId)
        assertEquals(19, GmsWorld.SCANIA.worldId)
        assertEquals(45, GmsWorld.KRONOS.worldId)
        assertEquals(70, GmsWorld.HYPERION.worldId)
    }

    @Test
    fun `Kronos and Hyperion are the ones that cannot trade`() {
        // The half of the mapping that changes a NUMBER. Getting a world's category backwards puts
        // a price box on a drop that can never be sold, or takes it off one that can.
        assertEquals(WORLD_HEROIC, GmsWorld.KRONOS.worldType)
        assertEquals(WORLD_HEROIC, GmsWorld.HYPERION.worldType)
        assertEquals(WORLD_INTERACTIVE, GmsWorld.BERA.worldType)
        assertEquals(WORLD_INTERACTIVE, GmsWorld.SCANIA.worldType)
    }

    @Test
    fun `one character per world was checked, and no world went unchecked`() {
        // The guard on the doc above: adding a world without pinning it leaves a row nobody has
        // ever confirmed, sitting among three that were, looking exactly as trustworthy.
        assertEquals(GmsWorld.entries.toSet(), verifiedAgainst.values.toSet())
        assertEquals(GmsWorld.entries.size, verifiedAgainst.size)
    }

    @Test
    fun `ids are unique, so a lookup cannot answer for two worlds`() {
        val ids = GmsWorld.entries.map { it.worldId }
        val names = GmsWorld.entries.map { it.displayName }
        assertEquals(GmsWorld.entries.size, ids.distinct().size)
        assertEquals(GmsWorld.entries.size, names.distinct().size)
    }

    @Test
    fun `an unknown id is null rather than a guess`() {
        // 0 and 120 are inside the range that was probed and found empty. A future id has to be
        // verified before it can be named, so returning null here is the whole point.
        assertNull(GmsWorld.byId(0))
        assertNull(GmsWorld.byId(120))
        assertEquals(GmsWorld.SCANIA, GmsWorld.byId(19))
    }

    @Test
    fun `a world reads back from the name that is stored`() {
        // characters.world_name holds the display name, so this is the round trip that lets the
        // stored column be read as a world again.
        for (world in GmsWorld.entries) {
            assertEquals(world, GmsWorld.byName(world.displayName))
        }
        assertEquals(GmsWorld.KRONOS, GmsWorld.byName("kronos"))
        assertNull(GmsWorld.byName("Windia"))
    }

    @Test
    fun `the ids the lookup probes are exactly the ones this file knows`() {
        // The fan-out and the mapping have to be the same list. Probing an id with no world would
        // find a character and be unable to say where they are; a world with no probe would be a
        // world nobody can be found in.
        assertEquals(GmsWorld.entries.map { it.worldId }, KNOWN_WORLD_IDS)
        assertTrue(KNOWN_WORLD_IDS.isNotEmpty())
    }
}
