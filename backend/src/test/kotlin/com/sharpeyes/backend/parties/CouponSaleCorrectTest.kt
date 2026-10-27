package com.sharpeyes.backend.parties

import com.sharpeyes.api.coupons.BOUGHT
import com.sharpeyes.api.coupons.KEPT
import com.sharpeyes.api.coupons.SOLD
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class CouponSaleCorrectTest {
    @Test
    fun `a sold or bought coupon sale can be repriced`() {
        assertNull(correctionRefusal(SOLD, 1_500_000_000))
        assertNull(correctionRefusal(BOUGHT, 1))
    }

    @Test
    fun `a kept stack has no price, and a price of nothing is a keep`() {
        // V50's constraint would refuse a KEPT row with money as a 500. This says why first.
        assertNotNull(correctionRefusal(KEPT, 1_500_000_000))
        assertNotNull(correctionRefusal(SOLD, 0))
        assertNotNull(correctionRefusal(SOLD, -1))
    }
}
