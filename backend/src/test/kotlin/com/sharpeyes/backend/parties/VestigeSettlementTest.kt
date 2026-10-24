package com.sharpeyes.backend.parties

import com.sharpeyes.api.vestige.VestigeHolder
import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Closing a holder's books, which is the one thing about the card that cannot be derived.
// See V52__vestige_settlement.sql.
class VestigeSettlementTest {
    private val self = VestigeHolder(kind = "SELF")
    private val drop = "6f1a8f6e-0000-4000-8000-000000000001"

    @Test
    fun `a settlement names the drops it closes`() {
        assertNull(settlementRefusal(self, listOf(drop), 0))
        assertNull(settlementRefusal(self, listOf(drop), 56_000_000))

        // Naming none would sit there looking as though it had closed something.
        assertTrue(settlementRefusal(self, emptyList(), 0)!!.contains("the drops it closes"))
        assertTrue(settlementRefusal(self, listOf("not-an-id"), 0)!!.contains("lootId"))
    }

    @Test
    fun `what was written off is recorded, and cannot be negative`() {
        // Zero is the ordinary case, a pile that balanced. Above zero is a decision, and it is stored
        // rather than dropped so that writing off 56m is visible afterwards.
        assertNull(settlementRefusal(self, listOf(drop), 0))
        assertTrue(settlementRefusal(self, listOf(drop), -1)!!.contains("unpaid"))
        // More arriving than was owed is an overpayment, which the card says separately.
        assertTrue(settlementRefusal(self, listOf(drop), 1_000_000_000_001)!!.contains("unpaid"))
    }

    @Test
    fun `the holder kind and its reference cannot disagree`() {
        assertTrue(settlementRefusal(VestigeHolder(kind = "NOBODY"), listOf(drop), 0)!!.contains("kind"))
        assertTrue(
            settlementRefusal(VestigeHolder(kind = "PERSON"), listOf(drop), 0)!!.contains("personId"),
        )
        assertTrue(
            settlementRefusal(VestigeHolder(kind = "CHARACTER"), listOf(drop), 0)!!
                .contains("characterName"),
        )
        assertTrue(settlementRefusal(self.copy(personId = "x"), listOf(drop), 0)!!.contains("personId"))
    }
}
