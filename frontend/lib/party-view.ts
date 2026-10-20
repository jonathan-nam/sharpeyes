// The Parties page's two tab rows, kept in the URL. See lib/url-state.ts.

import type { ClearFilter } from "@/lib/parties";
import { queryParam } from "@/lib/url-state";

export type Grouping = "character" | "boss" | "party";

export type PartyView = { grouping: Grouping; filter: ClearFilter; sharedOnly: boolean };

const GROUPINGS: readonly Grouping[] = ["character", "boss", "party"];
const FILTERS: readonly ClearFilter[] = ["all", "not-cleared", "cleared"];
const DEFAULT: PartyView = { grouping: "character", filter: "all", sharedOnly: false };

/** The view a query asks for. A missing or unknown value is the default, never an error. */
export function partyViewFromQuery(search: string): PartyView {
  return {
    grouping: queryParam(search, "by", GROUPINGS) ?? DEFAULT.grouping,
    filter: queryParam(search, "show", FILTERS) ?? DEFAULT.filter,
    sharedOnly: queryParam(search, "only", ["shared"] as const) === "shared",
  };
}

/** The params for one view. The defaults take none, so the plain page URL stays plain. */
export function partyViewQuery(view: PartyView): Record<string, string | null> {
  return {
    by: view.grouping === DEFAULT.grouping ? null : view.grouping,
    show: view.filter === DEFAULT.filter ? null : view.filter,
    only: view.sharedOnly ? "shared" : null,
  };
}
