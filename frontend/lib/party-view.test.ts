import { describe, expect, it } from "vitest";
import { partyViewFromQuery, partyViewQuery } from "./party-view";
import { withQuery } from "./url-state";

const href = (query: Record<string, string | null>) => withQuery("http://x/bosses/parties", query);

describe("the Parties page view in the URL", () => {
  it("opens By Character, All with no query", () => {
    expect(partyViewFromQuery("")).toEqual({ grouping: "character", filter: "all" });
    expect(href(partyViewQuery({ grouping: "character", filter: "all" }))).toBe("/bosses/parties");
  });

  it("reads back every view it writes", () => {
    for (const grouping of ["character", "boss", "party"] as const) {
      for (const filter of ["all", "not-cleared", "cleared"] as const) {
        const written = href(partyViewQuery({ grouping, filter }));
        expect(partyViewFromQuery(written.slice(written.indexOf("?")))).toEqual({
          grouping,
          filter,
        });
      }
    }
  });

  it("writes only what differs from the default", () => {
    expect(href(partyViewQuery({ grouping: "boss", filter: "all" }))).toBe(
      "/bosses/parties?by=boss",
    );
    expect(href(partyViewQuery({ grouping: "character", filter: "cleared" }))).toBe(
      "/bosses/parties?show=cleared",
    );
  });

  it("falls back to the default for a value it does not know", () => {
    expect(partyViewFromQuery("?by=world&show=maybe")).toEqual({
      grouping: "character",
      filter: "all",
    });
  });
});
