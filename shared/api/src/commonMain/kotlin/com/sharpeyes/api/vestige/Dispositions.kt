package com.sharpeyes.api.vestige

// What a tranche's pieces became, as `disposition` carries it.

/** A sale, with money in it. */
const val SOLD = "SOLD"

/** Pieces redeemed rather than sold, so out of the pile every price is derived from. See V46. */
const val KEPT = "KEPT"

/**
 * The creditor's pieces, taken by the holder at an agreed price. See V50.
 *
 * Carries money like a sale and leaves the pile like a redemption. What it is NOT is a sale: the
 * proceeds are one creditor's in full rather than the pile's to divide pro rata, because these
 * pieces never went to market.
 */
const val BOUGHT = "BOUGHT"

// Whose pile a proceeds disposal speaks for, as `heldBy` carries it. See V91.
const val HELD_BY_YOU = "YOU"
const val HELD_BY_THEM = "THEM"
