package com.sharpeyes.api.combine

import kotlinx.serialization.Serializable

/** A seat as the page draws it: the character and its sprite proxy path. */
@Serializable
data class SeatFace(
    val name: String,
    val sprite: String?,
)

/** One of the two parties of a conflict. */
@Serializable
data class CombineSideResponse(
    val partyId: String,
    val leader: String,
    val difficulty: String?,
    /** Standing seats, the owner's own included. */
    val members: List<SeatFace>,
)

/** A pair the sender has to choose for. */
@Serializable
data class CombinePairResponse(
    val bossKey: String,
    val boss: String,
    val mine: CombineSideResponse,
    val theirs: CombineSideResponse,
    /** Which of the two can be kept: the one already seating the other owner's character. */
    val keepable: List<String>,
    /** The first date the kept party would be shared from, combined now. */
    val sharedFrom: String,
)

/** Combining with one friend, from the sender's side. */
@Serializable
data class CombineWithResponse(
    /** Your person row for them. */
    val personId: String,
    val friend: String,
    val friendImage: String?,
    val matched: Int,
    /** Pairs that settle themselves, by whose copy they keep. */
    val keepsYours: Int,
    val keepsTheirs: Int,
    val conflicts: List<CombinePairResponse>,
    /** Your request to them, while it waits. */
    val sentRequestId: String?,
)

/** A request waiting on you, as one line. */
@Serializable
data class IncomingCombineResponse(
    val id: String,
    val friend: String,
    val friendImage: String?,
    val total: Int,
    val keepsYours: Int,
    val keepsTheirs: Int,
    /** Seats of yours it takes out, so nobody holds two parties for one boss. */
    val takesOut: List<SeatOutResponse> = emptyList(),
)

/** A seat taken out of one of your parties: who, and the boss and leader that name the party. */
@Serializable
data class SeatOutResponse(
    val name: String,
    val boss: String,
    val leader: String,
)

/** A character two parties would hold for one boss, for the sender to place. */
@Serializable
data class SeatClashResponse(
    val name: String,
    val boss: String,
    val sprite: String?,
    val options: List<SeatOptionResponse>,
)

/** A party the character could stay in. */
@Serializable
data class SeatOptionResponse(
    val partyId: String,
    val yours: Boolean,
    val leader: String,
    val difficulty: String?,
)

@Serializable
data class CombinePreviewResponse(
    val clashes: List<SeatClashResponse>,
)

@Serializable
data class CombinePageResponse(
    val friends: List<CombineWithResponse>,
    val incoming: List<IncomingCombineResponse>,
)

/** A conflict's answer: which of the two is kept. */
@Serializable
data class CombineChoiceRequest(
    val mine: String,
    val theirs: String,
    val keepPartyId: String,
)

/** Which party a character left in two keeps them. */
@Serializable
data class SeatChoiceRequest(
    val name: String,
    val keepPartyId: String,
)

@Serializable
data class SendCombineRequest(
    val personId: String,
    val choices: List<CombineChoiceRequest> = emptyList(),
    val seats: List<SeatChoiceRequest> = emptyList(),
)
