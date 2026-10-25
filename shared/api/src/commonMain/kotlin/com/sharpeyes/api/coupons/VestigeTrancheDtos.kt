package com.sharpeyes.api.coupons

import kotlinx.serialization.Serializable

/**
 * Whose pile a tranche is, as the three kinds V39 stores.
 *
 * Carried on the way out as well as in, so a client never has to infer the kind from which field is
 * null. A pile with no kind is a pile belonging to nobody, and it would price every boss it covers
 * at nothing.
 */
@Serializable
data class VestigeHolder(
    val kind: String,
    val personId: String? = null,
    /** Lowercased, as stored: it is an identity, and seats are matched by name everywhere else. */
    val characterName: String? = null,
)

/**
 * How many pieces of one sale were somebody else's. See V56.
 *
 * A COUNT. Their share of the money is `pieces * tranche amount / tranche pieces`, worked out on
 * read, so correcting a mistyped amount moves it. Storing the meso figure here would be storing a
 * derived share, which is what V40 exists to refuse.
 */
@Serializable
data class VestigeTrancheShareRow(
    /** The CREDITOR, in the same holder shape the pile uses. Never the pile's own holder. */
    val holder: VestigeHolder,
    val pieces: Double,
)

@Serializable
data class VestigeTrancheResponse(
    val id: String,
    val holder: VestigeHolder,
    val pieces: Double,
    /**
     * Mesos for the whole tranche. The per-piece figure is derived by the client, never stored.
     *
     * Null on a KEPT row. A redemption has no price, which is the point of recording it: those
     * pieces come out of the pile the prices are derived from instead of being priced at nothing.
     */
    val amount: Long? = null,
    /** SOLD or KEPT. Carried out, so a client never infers a redemption from a missing amount. */
    val disposition: String,
    /** Whose pieces this sale was, where any of them were not the seller's. Empty is all their own. */
    val shares: List<VestigeTrancheShareRow> = emptyList(),
    val soldAt: String,
    /** The reader wrote it, which is what lets them take it back. See V88. */
    val recordedByYou: Boolean = true,
    /** Who did, as the reader calls them, when it was not the reader. */
    val recordedByName: String? = null,
)

@Serializable
data class AddVestigeTrancheRequest(
    val holder: VestigeHolder,
    val pieces: Double,
    val amount: Long? = null,
    /** Defaults to a sale, which is what every tranche was before V46. */
    val disposition: String = SOLD,
    /**
     * Pieces of this sale that were somebody else's. Absent is all the seller's own, which is every
     * tranche entered before V56.
     */
    val shares: List<VestigeTrancheShareRow> = emptyList(),
)
