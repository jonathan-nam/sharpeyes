package com.sharpeyes.money

import com.sharpeyes.money.coupons.HolderLedger
import com.sharpeyes.money.coupons.LedgerEntry
import com.sharpeyes.money.pieces.AnsweredSale
import com.sharpeyes.money.pieces.BoughtPieces
import com.sharpeyes.money.pieces.PieceTransfer
import com.sharpeyes.money.settlement.nightsReached
import kotlin.test.Test
import kotlin.test.assertEquals

class AnsweredNightsTest {
    private val creditor = "person:pellmoor"

    private fun night(
        id: String,
        on: String,
        owed: Double,
        closed: Boolean = false,
    ) = LedgerEntry(
        lootId = id,
        partyId = "party",
        weekStart = on,
        droppedOn = on,
        recordedAt = "${on}T20:00:00Z",
        looterName = "Thornwick",
        ran = listOf("Thornwick", "Pellmoor"),
        pieces = 60.0,
        closed = closed,
        transfers = if (owed > 0) listOf(transfer(owed)) else emptyList(),
    )

    private fun transfer(pieces: Double) = PieceTransfer("self", creditor, "Thornwick", "Pellmoor", pieces)

    private fun ledger(
        drops: List<LedgerEntry>,
        sold: List<AnsweredSale>,
    ) = HolderLedger(
        holder = Holder("SELF"),
        holderName = "You",
        pieces = drops.sumOf { it.pieces },
        owedToYou = 0.0,
        received = 0.0,
        kept = 0.0,
        ownShare = 0.0,
        bought = BoughtPieces(0.0, 0.0),
        soldPieces = sold.sumOf { it.pieces },
        answered = sold.sumOf { it.pieces },
        answeredByCreditor = if (sold.isEmpty()) emptyMap() else mapOf(creditor to sold),
        closed = false,
        writtenOff = 0.0,
        accounted = sold.sumOf { it.pieces },
        drops = drops,
    )

    private val nights =
        listOf(
            night("old", "2026-09-03", 30.0),
            night("middle", "2026-09-10", 30.0),
            night("new", "2026-09-17", 30.0),
            night("even", "2026-09-24", 0.0),
        )

    @Test
    fun `no coupon sale reaches no night`() {
        assertEquals(emptySet(), nightsReached(listOf(ledger(nights, emptyList()))))
    }

    @Test
    fun `a sale reaches the newest nights first, and a night it covers in part counts`() {
        val sale = AnsweredSale(40.0, "2026-09-30T12:00:00Z")
        assertEquals(setOf("new", "middle"), nightsReached(listOf(ledger(nights, listOf(sale)))))
    }

    @Test
    fun `a sale reaches only nights logged before it`() {
        val sale = AnsweredSale(40.0, "2026-09-12T12:00:00Z")
        assertEquals(setOf("middle", "old"), nightsReached(listOf(ledger(nights, listOf(sale)))))
    }
}
