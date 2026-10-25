package com.sharpeyes.backend.parties

import com.sharpeyes.api.coupons.VestigeHolder
import com.sharpeyes.api.coupons.VestigeTrancheShareRow
import kotlin.uuid.Uuid

// Whose pieces a priced tranche was: the one place a coupon debt gets a price. See V56.
//
// It only ever prices a tranche WHOSE PRICE THE ENTERER TYPED. When you loot the lot, the pieces you
// owe are in your own inventory, so the figure being divided is one you know. What somebody else
// sold at is still not asked for, and still could not be answered: that is the pro rata #354 deleted.

/** A count off by less than this is the same count: they arrive held to the millionth. */
internal const val PIECE_DUST = 1e-6

/**
 * How one holder is matched, mirroring holderKey() in frontend/lib/vestige-ledger.ts.
 *
 * Only used to spot the same creditor named twice on one sale, which two rows would double.
 */

private fun VestigeHolder.key(): String =
    when (kind) {
        PERSON -> "person:$personId"
        CHARACTER -> "character:$characterName"
        else -> "self"
    }

/**
 * Why this tranche's attribution cannot be recorded, or null. See V56.
 *
 * The ceiling is here rather than on the table because a check constraint cannot read the parent
 * row. Attributing more pieces than the tranche held would credit somebody money it never made.
 */
internal fun shareRefusal(
    holder: VestigeHolder,
    pieces: Double,
    disposition: String,
    shares: List<VestigeTrancheShareRow>,
): String? {
    if (shares.isEmpty()) return null
    val bad = shares.firstOrNull { it.holder.kind !in setOf(PERSON, SELF, CHARACTER) }
    return when {
        // A redemption realized nothing, so there is no money in it to be anybody's. The other two
        // both carry a price the enterer typed, and a purchase is the one act that takes somebody
        // else's coupons without selling them: it has to be able to say whose. See V50.
        disposition !in PRICED -> "only a priced tranche can name whose pieces it was"
        bad != null -> "shares[].holder.kind must be one of $PERSON, $SELF, $CHARACTER"
        shares.any { (it.holder.kind == PERSON) != (it.holder.personId != null) } ->
            "a $PERSON holder needs a personId, and nothing else does"
        shares.any { (it.holder.kind == CHARACTER) != (it.holder.characterName != null) } ->
            "a $CHARACTER holder needs a characterName, and nothing else does"
        shares.any {
            it.holder.personId?.let { id -> runCatching { Uuid.parse(id) }.isFailure } == true
        } -> "personId is not an id"
        shares.any { it.pieces <= 0 } -> "shares[].pieces must be above 0"
        // The holder cannot owe themselves any of their own pile, and a creditor named twice would
        // be counted twice rather than added up.
        shares.any { it.holder.key() == holder.key() } ->
            "a tranche cannot owe its own pile"
        shares.map { it.holder.key() }.toSet().size != shares.size ->
            "each creditor may be named once on a tranche"
        // To the millionth a count is held to (lib/piece-ledger.ts pieces), so 22.5 + 22.5 is 45.
        shares.sumOf { it.pieces } > pieces + PIECE_DUST ->
            "shares name more pieces than the tranche held"
        else -> null
    }
}
