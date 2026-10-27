// The Drop Log's four stages: what fell, what you sold, what you are owed, and what is done.
//
// One direction only. A drop is logged, its pieces are sold or its item is priced, what that leaves
// owed is settled, and then it is finished and leaves the three worklists for good. The first three
// ask something of the reader; the last asks nothing and only records, which is why a finished row
// belongs in it and nowhere else.
//
// Each stage is its own page, listed under Drop Log in the header and linked to the next one along.
// In an Interactive world all four are always offered, empty or not: a page that came and went with
// its contents hid a ledger nobody had ever had anything on. An empty one says so instead.
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
   * pages that happen to be empty, they are pages that cannot fill. Same rule as the Drop Splitter's
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
  bulk: number;
  /** One card per unsold drop that prices alone, which is a row rather than a pile. See rowSales. */
  rows: number;
};

export function saleCards({ unanswered, holders, bulk, rows }: SaleCards): number {
  return (unanswered > 0 ? 1 : 0) + holders + bulk + rows;
}

// The nouns, not the furniture. "Ledger" was on three of the four and told none of them apart.
const SECTIONS: DropSection[] = [
  { key: "drops", label: "Drops" },
  { key: "sales", label: "Sales", interactiveOnly: true },
  { key: "settlement", label: "Settlements", interactiveOnly: true },
  { key: "settled", label: "Settlement History", interactiveOnly: true },
];

// Settlement History nests under Settlements, so the header lights Settlements on it.
const HREFS: Record<DropSectionKey, string> = {
  drops: "/bosses/drops",
  sales: "/bosses/drops/sales",
  settlement: "/bosses/drops/settlements",
  settled: "/bosses/drops/settlements/history",
};

/**
 * The stages for the world being shown, in pipeline order and the same however little is behind them.
 *
 * `trades` is /api/settings'. Undefined is the moment before it answers, and it offers all four:
 * it errs towards showing rather than hiding.
 */
export function dropSections(trades?: boolean): DropSection[] {
  if (trades !== false) return SECTIONS;
  return SECTIONS.filter((s) => !s.interactiveOnly);
}

/**
 * The section to draw: the one asked for where the world offers it, the Drops otherwise.
 *
 * The guard against toggling to Heroic while standing on a stage that Heroic does not carry.
 */
export function shownSection(chosen: DropSectionKey, sections: DropSection[]): DropSectionKey {
  return sections.some((s) => s.key === chosen) ? chosen : "drops";
}

/** The page one stage is on. */
export function sectionHref(key: DropSectionKey): string {
  return HREFS[key];
}

/** The stage a Drop Log path is, or undefined for one that is not a stage (a drop's own page). */
export function sectionFromPath(pathname: string): DropSectionKey | undefined {
  const path = pathname.replace(/\/$/, "");
  return SECTIONS.find((s) => HREFS[s.key] === path)?.key;
}

/** The stages either side of this one, for the links on its heading. */
export function sectionSteps(
  key: DropSectionKey,
  sections: DropSection[],
): { back?: DropSection; next?: DropSection } {
  const at = sections.findIndex((s) => s.key === key);
  if (at < 0) return {};
  return { back: sections[at - 1], next: sections[at + 1] };
}

/**
 * A link straight to one Settlement card, named by the person it is with. That person is the same
 * row whichever side reads the card: the owner's own card and the member's shared one.
 */
export function settlementCardHref(personId: string): string {
  return `${sectionHref("settlement")}?card=${encodeURIComponent(personId)}`;
}

/** The card a `?card=` asks for. */
export function cardFromQuery(search: string): string | undefined {
  return new URLSearchParams(search).get("card") ?? undefined;
}

/** The element id a Settlement card carries, which settlementCardHref scrolls to. */
export function cardAnchor(personId: string): string {
  return `settlement-card-${personId}`;
}

/** The stages the header and the home screen list: every one but the history, which asks nothing. */
export function homeSections(trades?: boolean): DropSection[] {
  return dropSections(trades).filter((s) => s.key !== "settled");
}
