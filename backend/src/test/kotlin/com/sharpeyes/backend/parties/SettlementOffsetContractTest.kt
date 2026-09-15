package com.sharpeyes.backend.parties

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The names on the wire, which is the only place the Settlement Ledger and this route meet.
 *
 * A renamed field type-checks on both sides and dies between them: the client's `OffsetShares` reads
 * `undefined` for a list, and the card it draws is the card that lost its figures. The same shape of
 * failure as the vision DTO that dropped fields silently, and cheap to pin.
 *
 * frontend/types/vestige.ts holds the other half of this contract.
 */
class SettlementOffsetContractTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `reads the body the card sends`() {
        val request =
            json.decodeFromString<OffsetSharesRequest>(
                """
                {
                  "holder": { "kind": "PERSON", "personId": "p-bro", "characterName": null },
                  "note": "offset against Bro",
                  "parts": [
                    { "lootId": "l1", "memberId": "m1", "amount": 703703488 }
                  ],
                  "holding": 2412222150
                }
                """.trimIndent(),
            )
        assertEquals("PERSON", request.holder.kind)
        assertEquals("offset against Bro", request.note)
        // The second pot, in the same request as the first. Both move on one press, and as two
        // requests the card drew what they owe you down twice for it.
        assertEquals(2_412_222_150, request.holding)
        assertEquals(1, request.parts.size)
        assertEquals("l1", request.parts[0].lootId)
        assertEquals("m1", request.parts[0].memberId)
        // POSITIVE on the wire. The entry it becomes is minus this, and a client sending the entry's
        // own sign would be asking for the debt to go UP.
        assertEquals(703_703_488, request.parts[0].amount)
    }

    @Test
    fun `holding is optional, a card with only shares to offset sending none`() {
        val request =
            json.decodeFromString<OffsetSharesRequest>(
                """
                {
                  "holder": { "kind": "PERSON", "personId": "p-bro", "characterName": null },
                  "parts": [{ "lootId": "l1", "memberId": "m1", "amount": 1 }]
                }
                """.trimIndent(),
            )
        assertNull(request.holding)
    }

    @Test
    fun `answers with every list under the names the card reads`() {
        val encoded =
            json.encodeToString(
                OffsetSharesResponse(pools = emptyList(), debts = emptyList(), disposals = emptyList()),
            )
        // `disposals` too, since the act now decides the coupon money as well: a client left to
        // fetch it is the second repaint this endpoint exists to remove.
        assertEquals(
            setOf("pools", "debts", "disposals"),
            json.parseToJsonElement(encoded).jsonObject.keys,
        )
    }
}
