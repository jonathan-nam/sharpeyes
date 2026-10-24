package com.sharpeyes.api.vestige

import kotlinx.serialization.Serializable

/** One share an offset discharged. The PAYOUT, since one drop owes several people. See V58. */
@Serializable
data class SettlementDebtPayoutRow(
    val lootId: String,
    val memberId: String,
)

@Serializable
data class SettlementDebtResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    /** The shares this discharged. Empty on a hand-entered debt, which is most of them. See V58. */
    val payouts: List<SettlementDebtPayoutRow> = emptyList(),
    val incurredAt: String,
    /** The reader wrote it, which is what lets them take it back. See V88. */
    val recordedByYou: Boolean = true,
    /** Who did, as the reader calls them, when it was not the reader. */
    val recordedByName: String? = null,
)

@Serializable
data class AddSettlementDebtRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    /** Only an offset names any. Absent is a debt somebody typed, which discharges no share. */
    val payouts: List<SettlementDebtPayoutRow> = emptyList(),
    /**
     * When the act happened, where that is not now.
     *
     * Only splitting an old offset into its shares sends one. Those rows are the SAME act as the
     * entry they replace, so re-dating them to the day of the split would move a history entry to
     * today and lose the one fact that tells two offsets against one person apart.
     */
    val incurredAt: String? = null,
)
