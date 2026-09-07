package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.DropCatalog
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll

// What a drop and a sale have to be true of before they are written. Beside the config rules in
// PartyValidation.kt rather than in them: these read a loot row, not a party.

// The bound V34__loot_quantity_and_shares.sql checks. Refused here so the answer is a reason rather
// than a constraint violation, and pinned by a test so the two cannot drift.
private const val MAX_QUANTITY = 1_000_000

// The bound V76 checks, in cents. A billion dollars, which is a bound on the arithmetic and not on
// the item: the split runs in the browser, where an integer stops being exact past 2^53.
private const val MAX_USD_CENTS = 100_000_000_000L

/**
 * Why this price cannot be recorded, or null. The currency rules, not the split's.
 *
 * A dollar sale replaces the meso one rather than annotating it, so `amount` is not checked when
 * cents are given: it is not stored, and refusing a stale figure the client did not mean to send
 * would fail sales for a field nothing reads.
 */
internal fun saleRefusal(request: SellLootRequest): String? {
    val cents = request.usdCents
    return when {
        cents == null -> if (request.amount < 0) "amount must be zero or more" else null
        cents <= 0 -> "a real money sale has to be more than nothing"
        cents > MAX_USD_CENTS -> "amount must be at most $MAX_USD_CENTS cents"
        // No Auction House stood in the way, so there is no cut to take off the top and nothing for
        // a gross figure to be gross OF. See V76.
        request.amountBasis == "LISTED" -> "a real money sale is never a listed one"
        else -> null
    }
}

/** Why this many of a drop cannot be logged, or null. */
internal fun quantityRefusal(quantity: Int): String? =
    if (quantity < 1 || quantity > MAX_QUANTITY) "quantity must be between 1 and $MAX_QUANTITY" else null

/**
 * Why these share counts cannot be pinned to a sale, or null.
 *
 * A seat the sale cannot owe is refused rather than ignored: accepting a share for somebody who did
 * not run that week would leave the party expecting a payout that no row exists for.
 */
internal fun sharesRefusal(
    shares: Map<String, Int>,
    ranThatWeek: List<String>,
): String? =
    when {
        shares.keys.any { it !in ranThatWeek } -> "shares may only name somebody who ran this boss that week"
        // Zero for the same reason a config allows it: a seat that takes nothing from this party.
        // See V44.
        shares.values.any { it < 0 || it > MAX_SHARES } -> "a share count must be between 0 and $MAX_SHARES"
        // Somebody has to be holding the pot. All zeroes divides by nothing. The seller's own count
        // is in this map too, so summing over who ran is the whole of it.
        ranThatWeek.sumOf { shares[it] ?: 1 } < 1 -> "somebody has to take a share of this sale"
        else -> null
    }

/**
 * Why this seat cannot be recorded as having taken the drop, or null.
 *
 * [canSell] is the important one, and it is not a technicality. In a trading world a drop that
 * changes hands is a SALE, with a pot and a roster owed a share of it. Recording it as taken
 * instead would move the drop off the pending list with nobody owed anything, so a party would
 * quietly stop being paid and the pool would look tidier for it.
 *
 * [instanced] is the other half of the same idea. An instanced drop is already in the inventory of
 * everyone who ran, so there is no one copy for a seat to have taken. Recording one hands over
 * something the party never held, and `takenTally` then counts the whole quantity against that
 * seat, which moves whose turn it is next. In Heroic that is every piece drop there is.
 *
 * Null [memberId] is how "put it back in the pool" is expressed, so it is only checked against the
 * week's roster when it names somebody. Putting one back is always allowed, including for a row
 * recorded before this refusal existed.
 */
internal fun takenRefusal(
    memberId: String?,
    ranThatWeek: List<String>,
    canSell: Boolean,
    sold: Boolean,
    instanced: Boolean = false,
): String? =
    when {
        canSell -> "This world trades, so a drop that changes hands is a sale."
        sold -> "This drop is already sold."
        instanced && memberId != null -> "Everyone who ran got their own, so nobody took it."
        memberId != null && memberId !in ranThatWeek ->
            "memberId must be somebody who ran this boss that week"
        else -> null
    }

/**
 * Why a pile of this drop cannot be priced as one lot, or null.
 *
 * The gate on the lot sale. Without it, that route prices any drop off a queue, including the ones
 * whose copies each carry their own potential and their own price, and for those a queue can only
 * guess which one went. A key the catalog does not have is refused here too.
 *
 * Reads the catalog, unlike the pure checks around it, because whether copies are interchangeable is
 * a property of the drop rather than of the request. See V45__drop_fungible.sql.
 */
internal fun lotDropRefusal(dropKey: String): String? {
    val fungible =
        DropCatalog
            .selectAll()
            .where { DropCatalog.dropKey eq dropKey }
            .firstOrNull()
            ?.get(DropCatalog.fungible) == true
    return if (fungible) null else "$dropKey is not sold as a lot, so each of its drops is priced where it sits"
}

/**
 * Why these rows cannot be one lot, or null. The checks that need no database.
 *
 * Split from the per-row ones in LootWrites.kt because these are about the LOT: that it names
 * something, that it names nothing twice, and that the slices its rows carry add up to the sale.
 * That last one is the important one. The rows carry the division of the lot, so this is the only
 * check that it IS a division of it, and a client that lost a meso to rounding would otherwise file
 * rows summing to less than the price with every figure downstream looking ordinary.
 */
internal fun lotRequestRefusal(
    request: LotSaleRequest,
    rows: List<LotRow>,
): String? =
    when {
        rows.isEmpty() -> "name at least one drop to sell"
        rows.map { it.lootId }.distinct().size != rows.size ->
            "the same drop is named twice, so the lot would price it once and be short"
        request.amountBasis !in AMOUNT_BASES -> "amountBasis must be LISTED, RECEIVED or BOUGHT"
        request.splitMethod !in SPLIT_METHODS -> "splitMethod must be LAZY or FAIR"
        request.total < 0 -> "total must be zero or more"
        rows.sumOf { it.amount } != request.total ->
            "the rows add up to ${rows.sumOf { it.amount }}, not the ${request.total} the lot sold for"
        else -> null
    }

/**
 * Why this arrangement of stacks cannot be recorded against a drop, or null.
 *
 * The sum has to be the whole drop. A partial arrangement is the dangerous shape: it looks answered
 * and produces a debt measured against stacks nobody accounted for, which is a confident wrong
 * number rather than a missing one. Empty is how "nobody has said" is expressed, and it is written
 * by deleting the rows rather than by storing a partial one.
 *
 * `bundles` null is a drop whose stacks nobody has counted, so there is nothing to check an
 * arrangement against and it is refused rather than stored unvalidated.
 */
internal fun bundlesRefusal(
    assignment: Map<String, Int>,
    ranThatWeek: List<String>,
    bundles: Int?,
): String? =
    when {
        assignment.isEmpty() -> null
        bundles == null -> "this drop has no stack count, so who picked up which cannot be recorded"
        assignment.keys.any { it !in ranThatWeek } ->
            "stacks may only be given to somebody who ran this boss that week"
        assignment.values.any { it < 1 } -> "a seat that picked up no stacks is left out, not given zero"
        assignment.values.sum() != bundles ->
            "the stacks have to add up to the $bundles this drop fell in, got ${assignment.values.sum()}"
        else -> null
    }
