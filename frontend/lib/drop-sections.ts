// The Drop Log's four stages: what fell, what you sold, what you are owed, and what is done.
//
// One direction only. A drop is logged, its pieces are sold or its item is priced, what that leaves
// owed is settled, and then it is finished and leaves the three worklists for good. The first three
// ask something of the reader; the last asks nothing and only records, which is why a finished row
// belongs in it and nowhere else.
//
// In an Interactive world all four are always offered, empty or not. They used to come and go with
// their contents, which had two costs: a tab could vanish from under the reader as they recorded
// the last thing on it, silently moving them somewhere else, and a ledger nobody had ever had
// anything on was invisible, so there was no way to learn it existed. An empty one says so instead.
//
// A Heroic world is the one exception, and it is not "empty" but "does not apply". See below.

export type DropSectionKey = "drops" | "sales" | "settlement" | "settled";

export type DropSection = {
  key: DropSectionKey;
  label: string;
  /**
   * Only offered while the world being shown can trade.
   *
   * Three of the four stages exist because something changed hands, and nothing does in a Heroic
   * world. Their pools are narrowed to the shown world server-side (LootQueries), so these are not
   * tabs that happen to be empty, they are tabs that cannot fill. Same rule as the Split Utility's
   * on the section menu, and the way back is the same one click on the world toggle.
   */
  interactiveOnly?: boolean;
};

/** What the Sale Ledger would draw, in cards. Zero is what puts the empty line on screen. */
export type SaleCards = {
  /** Nights nobody has said the stack arrangement for. One card holds all of them. */
  unanswered: number;
  /** One card per person holding a pile of coupons. */
  holders: number;
  /** One card per pile of an interchangeable drop waiting to be priced. */
  lots: number;
  /** One card per unsold drop that prices alone, which is a row rather than a pile. See rowSales. */
  rows: number;
};

export function saleCards({ unanswered, holders, lots, rows }: SaleCards): number {
  return (unanswered > 0 ? 1 : 0) + holders + lots + rows;
}

// The tab labels, which are the nouns and not the furniture. "Ledger" was on three of the four and
// said nothing that told them apart, next to a "Settled" that never carried it.
const SECTIONS: DropSection[] = [
  { key: "drops", label: "Drops" },
  { key: "sales", label: "Sales", interactiveOnly: true },
  { key: "settlement", label: "Settlements", interactiveOnly: true },
  { key: "settled", label: "Settled", interactiveOnly: true },
];

/**
 * The tabs for the world being shown, in pipeline order and the same however little is behind them.
 *
 * `trades` is /api/settings'. Undefined is the moment before it answers, and it offers all four:
 * that is what this did before it took an argument, and it errs towards showing rather than hiding.
 */
export function dropSections(trades?: boolean): DropSection[] {
  if (trades !== false) return SECTIONS;
  return SECTIONS.filter((s) => !s.interactiveOnly);
}

/**
 * The section to draw: the chosen one where the world offers it, the Drop Ledger otherwise.
 *
 * Kept as a function rather than read straight from state because it is the guard against a key
 * this world does not have, whether from an old cached value or from toggling to Heroic while
 * standing on a tab that Heroic does not carry.
 */
export function shownSection(chosen: DropSectionKey, sections: DropSection[]): DropSectionKey {
  return sections.some((s) => s.key === chosen) ? chosen : "drops";
}
