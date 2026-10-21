package com.sharpeyes.backend.parties

import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The other half of the piece ledger: what a holder actually paid, as against what they owe.
// See V51__vestige_payment.sql.
class VestigePaymentTest {
    @Test
    fun `a payment needs a holder it can be filed against, and money in it`() {
        val self = VestigeHolder(kind = "SELF")
        val bro = VestigeHolder(kind = "PERSON", personId = "6f1a8f6e-0000-4000-8000-000000000001")
        val stranger = VestigeHolder(kind = "CHARACTER", characterName = "freeballynn")

        assertNull(paymentRefusal(self, 4_875_000_000))
        assertNull(paymentRefusal(bro, 4_875_000_000))
        assertNull(paymentRefusal(stranger, 1))

        // Nothing arriving is the absence of an event, not one worth a row. Negative is money you
        // sent them, which is one (V89).
        assertTrue(paymentRefusal(self, 0)!!.contains("nonzero"))
        assertNull(paymentRefusal(bro, -1))

        // The kind and its reference cannot disagree, the same pair of checks a tranche gets: a
        // PERSON payment with no person would clear a debt belonging to nobody.
        assertTrue(paymentRefusal(VestigeHolder(kind = "NOBODY"), 1)!!.contains("kind"))
        assertTrue(paymentRefusal(VestigeHolder(kind = "PERSON"), 1)!!.contains("personId"))
        assertTrue(paymentRefusal(VestigeHolder(kind = "CHARACTER"), 1)!!.contains("characterName"))
        assertTrue(paymentRefusal(self.copy(personId = "x"), 1)!!.contains("personId"))
        assertTrue(
            paymentRefusal(VestigeHolder(kind = "PERSON", personId = "not-an-id"), 1)!!
                .contains("not an id"),
        )
    }

    @Test
    fun `a payment may say what it was for, within the same bound an entered debt has`() {
        val self = VestigeHolder(kind = "SELF")

        assertNull(paymentRefusal(self, 1, null))
        assertNull(paymentRefusal(self, 1, "x".repeat(120)))
        assertTrue(paymentRefusal(self, 1, "x".repeat(121))!!.contains("120"))
    }

    @Test
    fun `a payment is not measured against the debt`() {
        val self = VestigeHolder(kind = "SELF")

        // Deliberate. The debt moves when an earlier week is edited or a sale is corrected, so a
        // payment refused for exceeding it would be a true fact turned away, and one that became
        // enterable again on the next edit. Overpayment is said on the card instead.
        assertNull(paymentRefusal(self, 1_000_000_000_000))
        assertTrue(paymentRefusal(self, 1_000_000_000_001)!!.contains("nonzero"))
        assertTrue(paymentRefusal(self, -1_000_000_000_001)!!.contains("nonzero"))
    }
}
