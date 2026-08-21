// Mirrors backend's parties/LootDtos.kt field-for-field.

export type LootPayout = {
  memberId: string;
  paid: boolean;
  paidAt: string | null;
  // Shares of the pot this member takes, pinned when the drop sold. 1 in an even split.
  shares: number;
};

export type Loot = {
  id: string;
  // Set when the drop came from a boss table; customName is set instead when it was typed.
  dropKey: string | null;
  customName: string | null;
  // Already resolved to whichever of the two applies.
  name: string;
  iconUrl: string | null;
  // ALWAYS or HEROIC when each member gets their own copy, so pooling it is not what it needs.
  perMember: string | null;
  bossKey: string | null;
  // How many of it fell. 1 for a drop that is one item; a stack of coupons is one row with its
  // count, which is what a night that will not divide evenly leaves one member holding.
  quantity: number;
  droppedOn: string;
  // The reset week droppedOn falls in, as that week's Thursday. The server's, so the Drop Log's
  // weeks are the same ones the clears matrix steps through. See BossPeriod.kt.
  weekStart: string;
  // PENDING, SOLD, PAID_OUT, or TAKEN where a world cannot sell. Derived by the server from the
  // sale, the payout rows and takenByMemberId.
  status: string;
  saleAmount: number | null;
  // LISTED, RECEIVED, or BOUGHT when a party member bought it off the party. BOUGHT is what the
  // whole drop is worth, the buyer's own share included, with no Auction House cut off the top: the
  // buyer keeps their share and hands over the rest. Read by basisOf() in lib/loot.ts, which
  // refuses anything else.
  amountBasis: string | null;
  // LAZY or FAIR.
  splitMethod: string | null;
  // The seller's own share count, pinned with the sale. Null until it sells.
  sellerShares: number | null;
  // Who holds the value and owes the rest: the seller, or the buyer on a BOUGHT basis.
  sellerMemberId: string | null;
  // Who took the item, where it cannot be sold. Nothing is owed off it: the item cannot move
  // again, so a seat's tally is how many they have taken and never a share of anything.
  takenByMemberId: string | null;
  // Which seat picked it up, for a drop that is one thing. Always null on a divisible one, whose
  // stacks bundlesBy names exactly and a single seat id could only round.
  //
  // OPTIONAL for the reason sharesThatWeek is: lib/cache.ts hands back whatever shape the API had
  // when the page last fetched, and absent has to mean "nobody said", which is what those rows
  // meant. See V64__loot_looter.sql.
  looterMemberId?: string | null;
  soldAt: string | null;
  // Who is owed, pinned when the drop sold. Empty before that.
  payouts: LootPayout[];
  // Seat ids of who ran the week this drop FELL in. Who may be named as its seller and who a sale
  // will owe, which is neither the party as it stands now nor every seat it has ever had.
  ranThatWeek: string[];
  // What each of those seats' shares was IN THAT WEEK, by seat id. Empty is every seat on its
  // standing share, which is every week nobody has changed the deal behind. See V55.
  //
  // OPTIONAL on purpose. lib/cache.ts hands back whatever shape the API had when the page last
  // fetched, so a tab open across the deploy that adds this gets rows without it; absent has to
  // mean "the standing share", which is exactly what those rows meant when they were cached.
  sharesThatWeek?: Record<string, number>;
  // How many equal stacks this drop fell in, for its boss and the party's difficulty. Null is
  // uncounted, NOT one stack: it is read to decide whether the drop could divide by looting at all.
  bundles: number | null;
  // Who picked up how many of those stacks. EMPTY is nobody having said, which is not the same as
  // an even split, and is why a debt's size can be known while its direction is not.
  bundlesBy: LootBundle[];
};

// One seat's share of the physical stacks. What somebody bent down for, never a computed share.
export type LootBundle = {
  memberId: string;
  bundles: number;
};

// One party's whole pool, from GET /api/parties/loot. Grouped by party because reading a split
// needs that party's seats.
export type PartyLootPool = {
  partyId: string;
  loot: Loot[];
};

export type AddLootBody = {
  dropKey?: string | null;
  customName?: string | null;
  bossKey?: string | null;
  // How many fell. Omitted is 1, which is every drop that is one item.
  quantity?: number;
  droppedOn?: string | null;
  /**
   * Who picked up which stacks, by seat id, when the form logging it already knows.
   *
   * Sent WITH the drop rather than PUT after it, so the pair cannot half-land: the server writes
   * both in one transaction and a refusal rolls the drop back too. Omitted is the ordinary case, a
   * drop nobody has answered for yet.
   */
  bundles?: Record<string, number>;
  // Which seat picked it up. Only a seat that RAN that week, the same list the seller comes from.
  looterMemberId?: string | null;
};

// POST /api/parties/loot. A drop named by character and boss, for the Drop Log: the pool is the
// server's to resolve, since a boss run alone has no party to name and may not have a pool yet.
export type LogDropBody = {
  characterId: string;
  bossKey: string;
  dropKey?: string | null;
  customName?: string | null;
  quantity?: number;
  // Which seat picked it up. Refused on a boss with no party yet, whose pool is about to be opened
  // solo and has one seat to name.
  looterMemberId?: string | null;
};

export type SellLootBody = {
  amount: number;
  amountBasis: string;
  splitMethod: string;
  sellerMemberId: string;
  // How many shares each seat takes, keyed by seat id, the seller's own included. A seat left out
  // takes one, so an even split sends nothing at all. Only seats that RAN that week may be named.
  shares?: Record<string, number>;
};

// PUT /api/parties/{id}/loot/{lootId}/taken. Who took the item, in a world that cannot sell it.
// Null puts the drop back in the pool. Only a seat that RAN that week may be named.
export type SetLootTakenBody = {
  memberId: string | null;
};

// PUT /api/parties/{id}/loot/{lootId}/bundles. The WHOLE arrangement, keyed by seat id: the counts
// have to add up to the stacks the drop fell in, so a request naming one seat could only be wrong.
// An empty map puts it back to nobody having said.
export type SetLootBundlesBody = {
  bundles: Record<string, number>;
};

// POST /api/parties/loot/settle. Every payout row one net transfer covers, marked paid together or
// not at all. Built by settlementFor() in lib/wallet.ts, never by hand at a call site.
export type SettleBody = {
  payouts: { lootId: string; memberId: string }[];
};
