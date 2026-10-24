import { describe, expect, it } from "vitest";
import { figuresToReport, liveListing } from "@/lib/settlement-listings";
import type { SharedCard } from "@/lib/shared-book";
import type { SettlementListing } from "@/types/settlement-listing";

// A listing is good for the figure it was posted for and no other. See backend SettlementListings.kt.

const listing = (amount: number): SettlementListing => ({
  id: `l-${amount}`,
  personId: "p-1",
  payer: "OWNER",
  amount,
  postedByYou: false,
  createdAt: "2026-10-24T00:00:00Z",
});

describe("liveListing", () => {
  it("is the listing for exactly this figure", () => {
    expect(liveListing([listing(300)], "p-1", "OWNER", 300)?.id).toBe("l-300");
  });

  it("is nothing once the figure has moved, before the backend has deleted it", () => {
    expect(liveListing([listing(300)], "p-1", "OWNER", 450)).toBeNull();
  });

  it("never answers for the other direction or another card", () => {
    expect(liveListing([listing(300)], "p-1", "MEMBER", 300)).toBeNull();
    expect(liveListing([listing(300)], "p-2", "OWNER", 300)).toBeNull();
  });
});

describe("figuresToReport", () => {
  it("reports a linked person with no row at zero, which deletes what was posted for them", () => {
    expect(figuresToReport([], ["p-1"], [])).toEqual([
      { personId: "p-1", payer: "OWNER", amount: 0 },
      { personId: "p-1", payer: "MEMBER", amount: 0 },
    ]);
  });

  it("reports a shared card from its owner's arithmetic, both ways", () => {
    const card = { personId: "p-9", held: { byOwner: 700, byYou: 200 } } as SharedCard;
    expect(figuresToReport([], [], [card])).toEqual([
      { personId: "p-9", payer: "OWNER", amount: 700 },
      { personId: "p-9", payer: "MEMBER", amount: 200 },
    ]);
  });
});
