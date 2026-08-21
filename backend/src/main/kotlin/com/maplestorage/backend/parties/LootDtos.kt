package com.maplestorage.backend.parties

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/loot.ts field-for-field.
//
// No share, payout or fee is computed here or stored. The split arithmetic has one implementation
// (frontend/lib/drop-split.ts) and these carry only what a human entered, plus who has been paid.

@Serializable
data class LootPayoutResponse(
    val memberId: String,
    val paid: Boolean,
    val paidAt: String?,
    // Shares of the pot this member takes, as pinned when the drop sold. 1 in an even split.
    val shares: Int = 1,
)

@Serializable
data class LootBundleResponse(
    val memberId: String,
    // Whole stacks this seat picked up. Never a share: it is what somebody bent down for.
    val bundles: Int,
)

@Serializable
data class LootResponse(
    val id: String,
    // The catalog drop this is, when it came from a boss table. Null for free text.
    val dropKey: String?,
    val customName: String?,
    // What to show: the catalog name or the typed one. Sent resolved so the client does not join
    // the drop catalog to draw a row.
    val name: String,
    val iconUrl: String?,
    // ALWAYS / HEROIC when each member gets their own copy of this drop. Carried onto the row so
    // the pool can say a split is not what this drop needs.
    val perMember: String?,
    val bossKey: String?,
    // How many of it fell. 1 for a drop that is one item; a stack of coupons is one row with its
    // count, which is what a night that will not divide evenly leaves one member holding.
    val quantity: Int = 1,
    val droppedOn: String,
    // The reset week droppedOn falls in, as that week's Thursday. Sent rather than derived on the
    // client so the week a drop is filed under is the same one ranThatWeek was read against, and
    // so the reset boundary keeps its single implementation in BossPeriod.kt.
    val weekStart: String,
    // PENDING (not sold), SOLD (sold, someone still unpaid), PAID_OUT (everyone paid), TAKEN
    // (somebody has the item, in a world that cannot sell it). Derived from the sale, the payout
    // rows and taken_by rather than stored, so it cannot drift from them.
    val status: String,
    val saleAmount: Long?,
    val amountBasis: String?,
    val splitMethod: String?,
    // The seller's own share count, pinned with the sale. Null until it sells.
    val sellerShares: Int? = null,
    // Who holds the value and owes the rest: the seller, or the buyer when a member bought it.
    val sellerMemberId: String?,
    // Who took the item, where it cannot be sold. Null until somebody does, and never set at the
    // same time as a sale. Nothing is owed off it: the item cannot move again. See V49.
    val takenByMemberId: String? = null,
    // Which seat picked it up. Null is nobody having said, and is what a divisible drop always
    // carries: its stacks are bundlesBy's to name one by one. See V64__loot_looter.sql.
    val looterMemberId: String? = null,
    val soldAt: String?,
    // Who is owed, as pinned when the drop sold. Empty until then.
    val payouts: List<LootPayoutResponse>,
    // Seat ids of who ran the week this drop FELL in. Who a sale may name as its seller and who it
    // will owe, which is neither the party as it stands now nor every seat it has ever had. The
    // seller select reads this, so it offers exactly what the sell route accepts.
    val ranThatWeek: List<String> = emptyList(),
    // What each of those seats' shares was IN THAT WEEK, keyed by seat id. Empty is every seat on
    // its standing party_member.shares, which is every week nobody has changed the deal behind.
    //
    // Carried beside the roster because it answers the other half of the same question: who ran, and
    // on what share. Without it a new deal re-divides every outstanding drop the moment it is
    // agreed, including weeks somebody was already shown a figure for. See V55.
    val sharesThatWeek: Map<String, Int> = emptyMap(),
    // How many equal stacks this drop fell in, for this boss and the party's difficulty. Null is
    // uncounted, NOT one: the ledger reads it to decide whether the drop could divide by looting at
    // all, and a wrong one there invents a debt. See V41__loot_bundles.sql.
    val bundles: Int? = null,
    // Who picked up how many of those stacks. EMPTY means nobody has said, which is not the same as
    // it having divided evenly, and is why the ledger can name a debt's size without its direction.
    val bundlesBy: List<LootBundleResponse> = emptyList(),
)

/**
 * One party's whole pool, for the account-wide read behind the wallet.
 *
 * Grouped by party because the split needs the party's seats to be read at all: a share is owed by
 * one seat to another, and which seats those are is the party's, not the drop's.
 */
@Serializable
data class PartyLootPoolResponse(
    val partyId: String,
    val loot: List<LootResponse>,
)

@Serializable
data class AddLootRequest(
    // Exactly one of these. A drop key names a catalog item (and brings its icon and per-member
    // warning); custom text covers anything the tables do not list.
    val dropKey: String? = null,
    val customName: String? = null,
    val bossKey: String? = null,
    // How many fell. 1 unless the drop stacks.
    val quantity: Int = 1,
    // ISO date. Defaults to today on the server, which is the day you are almost always logging.
    val droppedOn: String? = null,
    // Who picked up which stacks, when the form that logged it already knows. Absent is the ordinary
    // case: a drop nobody has answered for yet, exactly as PUT /{lootId}/bundles leaves it.
    //
    // Carried with the drop rather than PUT after it so the pair cannot half-land. Refusing it rolls
    // the drop back too, because one act was asked for and one answer is owed. See addedBundles.
    val bundles: Map<String, Int>? = null,
    // Which seat picked it up, when the drop is one thing. Has to be a seat that RAN that week, the
    // same list the seller comes from. Absent is nobody having said, which is what the API-only
    // caller and a row filed from a clear both leave.
    val looterMemberId: String? = null,
)

/**
 * A drop logged without naming a pool: whose character it fell on, and which boss.
 *
 * The pool is resolved rather than sent, because a drop that fell on a boss you solo has no party
 * to name and the client cannot know which one it would be otherwise. That character's config for
 * that boss takes it if there is one, and a solo config is opened if there is not. Sending a party
 * id instead would let the Drop Log file a drop in the wrong pool the moment a config is created
 * or deleted between the page loading and the submit.
 */
@Serializable
data class LogDropRequest(
    val characterId: String,
    // Required here, unlike AddLootRequest's: it is half of which pool this drop belongs to.
    val bossKey: String,
    // Exactly one of these, as AddLootRequest.
    val dropKey: String? = null,
    val customName: String? = null,
    val quantity: Int = 1,
    val droppedOn: String? = null,
    // As AddLootRequest's. Checked against the resolved pool's week roster, which for a solo config
    // opened by this very request is the one character in it.
    val looterMemberId: String? = null,
)

/**
 * Marking a drop sold: the facts of the sale, none of its arithmetic.
 *
 * Sending this again updates the figures (a corrected price, the other split method) and leaves
 * the payout roster alone, so who has already been paid survives a typo fix.
 */
@Serializable
data class SellLootRequest(
    val amount: Long,
    // LISTED (what it was listed at), RECEIVED (what landed in the seller's inventory), or BOUGHT
    // (what the whole drop is worth, the buyer's own share included, with no Auction House cut off
    // the top). BOUGHT is the pot and not what changed hands: the buyer keeps their share of it and
    // hands over the rest, so entering only what they handed over shorts every other seat.
    val amountBasis: String,
    // LAZY or FAIR. See lib/drop-split.ts for what the difference costs.
    val splitMethod: String,
    // The seller, or on a BOUGHT basis the member who bought it. Either way the seat the shares
    // are measured from, and the one seat the sale does not owe.
    val sellerMemberId: String,
    /**
     * How many shares each seat takes, keyed by seat id, the seller's own included. A seat left out
     * takes one, so an even split sends nothing at all.
     *
     * Named seats have to be seats that RAN that week, the same list the seller comes from. A share
     * for somebody the sale cannot owe would be accepted and then never paid, which is a split
     * silently short a person.
     */
    val shares: Map<String, Int> = emptyMap(),
)

/**
 * One row of a lot, priced: which drop in which pool, and the sale to file against it.
 *
 * The amount is this row's slice of what the lot fetched, worked out by the client so the split's
 * arithmetic keeps its one implementation (frontend/lib/lot-sale.ts, over piece-ledger's largest
 * remainder). The route checks the slices add up to the lot rather than dividing anything itself.
 */
@Serializable
data class LotSaleRow(
    val partyId: String,
    val lootId: String,
    val amount: Long,
    // The seller's seat IN THIS PARTY. One person selling a lot holds a different seat in each pool
    // it spans, so this cannot be one id for the request.
    val sellerMemberId: String,
    val shares: Map<String, Int> = emptyMap(),
)

/**
 * Selling a pile of one interchangeable drop in a single go.
 *
 * The rows are named rather than worked out here, because the queue that proposed them is what the
 * user confirmed on screen. A server that re-derived "the oldest unsold rows" could sell different
 * ones than the preview showed, the moment a tab is stale or two are open, and the sale would land
 * on a party that never made it.
 *
 * All of them or none, for the reason SettleRequest gives: a lot that half-lands leaves some rows
 * priced and some not, with nothing on screen saying which half happened.
 */
@Serializable
data class LotSaleRequest(
    // Every row has to be this drop, and it has to be one the catalog marks fungible.
    val dropKey: String,
    // What the whole lot fetched. Checked against the rows, never divided here.
    val total: Long,
    val amountBasis: String,
    val splitMethod: String,
    val rows: List<LotSaleRow>,
)

@Serializable
data class PayoutRequest(
    val paid: Boolean,
)

/**
 * Who took the item, where it cannot be sold. Null puts the drop back in the pool.
 *
 * One seat, not a set of shares: this is an item somebody now holds, not a pot being divided. See
 * V49.
 */
@Serializable
data class TakenRequest(
    val memberId: String? = null,
)

/**
 * Who picked up which stacks of a drop, keyed by seat id.
 *
 * The whole arrangement every time, because it is replaced whole: the counts have to add up to the
 * stacks the drop fell in, and a request that named one seat could only ever leave a sum that does
 * not. Empty puts it back to nobody having said, which is a different thing from an even split.
 */
@Serializable
data class LootBundlesRequest(
    val bundles: Map<String, Int> = emptyMap(),
)

/** One payout row, named the only way it is unique: which drop, and who is owed on it. */
@Serializable
data class PayoutRef(
    val lootId: String,
    val memberId: String,
)

/**
 * Settling a whole relationship in one go: every payout row that one net transfer covers.
 *
 * The client names the rows rather than naming a person, because who owes whom is worked out by
 * frontend/lib/wallet.ts and a second implementation here would be a second answer to it. This
 * end of it only marks rows paid.
 *
 * All of them or none. A settle that half-lands leaves some shares paid and some not, with the
 * wallet showing a smaller debt and nothing on screen saying which part of the transfer happened.
 */
@Serializable
data class SettleRequest(
    val payouts: List<PayoutRef>,
)
