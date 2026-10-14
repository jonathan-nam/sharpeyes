// The Parties page's two tab rows, kept in the URL so a reload lands on the same view. Same
// approach as the Drop Log's `?section=`: see lib/drop-sections.ts.

import type { ClearFilter } from "@/lib/parties";

export type Grouping = "character" | "boss" | "party";

export type PartyView = { grouping: Grouping; filter: ClearFilter };

const GROUPINGS: readonly Grouping[] = ["character", "boss", "party"];
const FILTERS: readonly ClearFilter[] = ["all", "not-cleared", "cleared"];
const DEFAULT: PartyView = { grouping: "character", filter: "all" };

/** The view a query asks for. A missing or unknown value is the default, never an error. */
export function partyViewFromQuery(search: string): PartyView {
  const query = new URLSearchParams(search);
  const by = query.get("by");
  const show = query.get("show");
  return {
    grouping: GROUPINGS.find((g) => g === by) ?? DEFAULT.grouping,
    filter: FILTERS.find((f) => f === show) ?? DEFAULT.filter,
  };
}

/** A link to one view. The defaults take no query, so the plain page URL stays plain. */
export function partyViewHref(view: PartyView): string {
  const query = new URLSearchParams();
  if (view.grouping !== DEFAULT.grouping) query.set("by", view.grouping);
  if (view.filter !== DEFAULT.filter) query.set("show", view.filter);
  const search = query.toString();
  return search ? `/bosses/parties?${search}` : "/bosses/parties";
}
