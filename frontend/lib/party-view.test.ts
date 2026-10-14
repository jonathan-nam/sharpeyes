import { describe, expect, it } from "vitest";
import { partyViewFromQuery, partyViewHref } from "./party-view";

describe("the Parties page view in the URL", () => {
  it("opens By Character, All with no query", () => {
    expect(partyViewFromQuery("")).toEqual({ grouping: "character", filter: "all" });
    expect(partyViewHref({ grouping: "character", filter: "all" })).toBe("/bosses/parties");
  });

  it("reads back every view it writes", () => {
    for (const grouping of ["character", "boss", "party"] as const) {
      for (const filter of ["all", "not-cleared", "cleared"] as const) {
        const href = partyViewHref({ grouping, filter });
        expect(partyViewFromQuery(href.slice(href.indexOf("?")))).toEqual({ grouping, filter });
      }
    }
  });

  it("writes only what differs from the default", () => {
    expect(partyViewHref({ grouping: "boss", filter: "all" })).toBe("/bosses/parties?by=boss");
    expect(partyViewHref({ grouping: "character", filter: "cleared" })).toBe(
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
