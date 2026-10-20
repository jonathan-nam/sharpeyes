import { describe, expect, it } from "vitest";
import { partyViewFromQuery, partyViewQuery } from "./party-view";
import { withQuery } from "./url-state";

const href = (query: Record<string, string | null>) => withQuery("http://x/bosses/parties", query);
const plain = { grouping: "character", filter: "all", sharedOnly: false } as const;

describe("the Parties page view in the URL", () => {
  it("opens By Character, All, everybody's parties with no query", () => {
    expect(partyViewFromQuery("")).toEqual(plain);
    expect(href(partyViewQuery(plain))).toBe("/bosses/parties");
  });

  it("reads back every view it writes", () => {
    for (const grouping of ["character", "boss", "party"] as const) {
      for (const filter of ["all", "not-cleared", "cleared"] as const) {
        for (const sharedOnly of [false, true]) {
          const written = href(partyViewQuery({ grouping, filter, sharedOnly }));
          expect(partyViewFromQuery(written.slice(written.indexOf("?")))).toEqual({
            grouping,
            filter,
            sharedOnly,
          });
        }
      }
    }
  });

  it("writes only what differs from the default", () => {
    expect(href(partyViewQuery({ ...plain, grouping: "boss" }))).toBe("/bosses/parties?by=boss");
    expect(href(partyViewQuery({ ...plain, filter: "cleared" }))).toBe(
      "/bosses/parties?show=cleared",
    );
    expect(href(partyViewQuery({ ...plain, sharedOnly: true }))).toBe(
      "/bosses/parties?only=shared",
    );
  });

  it("falls back to the default for a value it does not know", () => {
    expect(partyViewFromQuery("?by=world&show=maybe&only=mine")).toEqual(plain);
  });
});
