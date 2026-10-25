package com.sharpeyes.backend.parties

import com.sharpeyes.api.coupons.VestigeHolder
import com.sharpeyes.api.coupons.VestigeTrancheShareRow
import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The two halves of V56: whose pieces a sale was, and what somebody owes you that no drop accounts
// for. See V56__collection_balance.sql.
class SettlementBalanceTest {
    private val self = VestigeHolder(kind = "SELF")
    private val owen = VestigeHolder(kind = "PERSON", personId = "6f1a8f6e-0000-4000-8000-000000000001")
    private val felix = VestigeHolder(kind = "PERSON", personId = "6f1a8f6e-0000-4000-8000-000000000002")
    private val stranger = VestigeHolder(kind = "CHARACTER", characterName = "quessa")

    private fun share(
        holder: VestigeHolder,
        pieces: Int,
    ) = VestigeTrancheShareRow(holder, pieces.toDouble())

    @Test
    fun `a sale may say how many of its pieces were somebody else's`() {
        // The night this exists for: 160 fell, 80 were theirs, you looted the lot and sold it.
        assertNull(shareRefusal(self, 160.0, "SOLD", listOf(share(owen, 80))))
        assertNull(shareRefusal(self, 160.0, "SOLD", listOf(share(owen, 60), share(stranger, 40))))
        // Absent is the whole sale being your own, which is every tranche entered before V56.
        assertNull(shareRefusal(self, 160.0, "KEPT", emptyList()))
    }

    @Test
    fun `a sale cannot give away more than it held`() {
        // The ceiling a check constraint cannot enforce, because it needs the parent row. Crediting
        // 200 pieces out of a sale of 160 hands somebody money the lot never made.
        assertTrue(shareRefusal(self, 160.0, "SOLD", listOf(share(owen, 200)))!!.contains("more pieces"))
        assertTrue(
            shareRefusal(self, 100.0, "SOLD", listOf(share(owen, 60), share(felix, 60)))!!
                .contains("more pieces"),
        )
        // Exactly all of it is a night where none of the coupons were yours, which happens.
        assertNull(shareRefusal(self, 160.0, "SOLD", listOf(share(owen, 160))))
    }

    @Test
    fun `a redemption divides nothing, having realized nothing`() {
        assertTrue(shareRefusal(self, 80.0, "KEPT", listOf(share(owen, 80)))!!.contains("priced"))
    }

    @Test
    fun `a purchase divides, at the price it names`() {
        // "I took theirs, at a price" is the whole act of keeping somebody's coupons against what they
        // owe you. Refusing the attribution left the pieces settled and the money for them stated
        // nowhere, so the debt it was meant to discharge did not move.
        assertNull(shareRefusal(self, 80.0, "BOUGHT", listOf(share(owen, 80))))
        // And the same ceiling as a sale, since the price is divided the same way.
        assertTrue(
            shareRefusal(self, 80.0, "BOUGHT", listOf(share(owen, 100)))!!.contains("more pieces"),
        )
    }

    @Test
    fun `a sale cannot owe its own pile, nor one person twice`() {
        // Owing yourself is not a debt. The same creditor on two rows would be counted twice rather
        // than added up, which is the quiet wrong number rather than a loud one.
        assertTrue(shareRefusal(self, 160.0, "SOLD", listOf(share(self, 80)))!!.contains("own pile"))
        assertTrue(
            shareRefusal(self, 160.0, "SOLD", listOf(share(owen, 40), share(owen, 40)))!!
                .contains("once"),
        )
    }

    @Test
    fun `a share names a creditor the same way a pile names a holder`() {
        assertTrue(
            shareRefusal(self, 80.0, "SOLD", listOf(share(VestigeHolder(kind = "NOBODY"), 1)))!!
                .contains("kind"),
        )
        assertTrue(
            shareRefusal(self, 80.0, "SOLD", listOf(share(VestigeHolder(kind = "PERSON"), 1)))!!
                .contains("personId"),
        )
        assertTrue(
            shareRefusal(self, 80.0, "SOLD", listOf(share(VestigeHolder(kind = "CHARACTER"), 1)))!!
                .contains("characterName"),
        )
        assertTrue(
            shareRefusal(
                self,
                80.0,
                "SOLD",
                listOf(share(VestigeHolder(kind = "PERSON", personId = "nope"), 1)),
            )!!.contains("not an id"),
        )
        assertTrue(shareRefusal(self, 80.0, "SOLD", listOf(share(owen, 0)))!!.contains("above 0"))
    }

    @Test
    fun `an entered debt needs somebody to owe it and money in it`() {
        assertNull(debtRefusal(owen, 1_500_000_000, "Ludi loan"))
        assertNull(debtRefusal(stranger, 1, null))

        // A debt to yourself is not one. A tranche and a payment allow SELF because those are about
        // a PILE, and one of the piles is yours; this is about two people.
        assertTrue(debtRefusal(self, 1, null)!!.contains("kind"))

        // Signed since V57: a debt of yours discharged against theirs is a negative adjustment.
        assertNull(debtRefusal(owen, -139_548_023, "armor box share"))
        assertTrue(debtRefusal(owen, 0, null)!!.contains("zero"))
        assertTrue(debtRefusal(owen, 1_000_000_000_001, null)!!.contains("between"))
        assertTrue(debtRefusal(owen, -1_000_000_000_001, null)!!.contains("between"))
        assertTrue(debtRefusal(owen, 1, "x".repeat(121))!!.contains("120"))
        assertNull(debtRefusal(owen, 1, "x".repeat(120)))
    }

    @Test
    fun `a debt may carry the day the act happened, and an unreadable one is refused`() {
        // Splitting an old offset into its shares sends the entry's own date. Falling back to now()
        // on a date it could not read would move a history entry to today and say nothing, which is
        // the same silent re-dating the field exists to prevent.
        assertNull(debtRefusal(owen, -139_548_023, null, "2026-08-29T15:14:30.258803Z"))
        assertNull(debtRefusal(owen, -139_548_023, null, null))
        assertTrue(debtRefusal(owen, 1, null, "29 August")!!.contains("timestamp"))
        assertTrue(debtRefusal(owen, 1, null, "")!!.contains("timestamp"))
    }
}
