import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sharePercents } from "./shares";

// A sale opens on an even split, whatever ratio the party's config is on.
//
// `party_member.shares` is the STACK entitlement: the party config's boxes write it, and a duo that
// cannot split three vestige stacks evenly is stored as 1:2. The sale form seeded its boxes from it,
// so that party's every ring and grindstone opened at 1:2 as well. It divides the coupon pile and
// nothing else, which is ranSeats' job.
//
// The bulk-sale side of this is pinned by bulk-sale.test.ts, which can call the function. There are no
// component tests in this repo, so the form's seed is read off the source, as piece-row-guard does.
//
// One file, because there is one form: LootSaleForm is the boxes on the pool row AND the boxes on
// the Sale Ledger card that prices the same drop. A second copy is what this would stop catching.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const form = source("components", "loot-sale-form.tsx");
const row = source("components", "loot-row.tsx");
const lot = source("components", "bulk-sale.tsx");

describe("the sale form's share boxes", () => {
  it("open on one share each", () => {
    expect(form).toContain('const shareOf = (memberId: string) => shares[memberId] ?? "1";');
  });

  it("read no stored ratio, standing or pinned", () => {
    expect(form).not.toContain("sharesThatWeek");
    expect(form).not.toContain("?.shares");
  });

  it("are still typeable, so an uneven split is one box away", () => {
    expect(form).toContain("aria-label={`Shares for ${m.name}`}");
  });

  it("is the only sale form, so the row grew no boxes of its own", () => {
    expect(row).toContain("<LootSaleForm");
    expect(row).not.toContain("loot-share-input");
  });

  it("says what a blank box means, and does not suggest a ratio in its place", () => {
    // Blank is ONE (V44), so an example like "80" sitting in an empty box would state a split
    // nobody typed, which is the confident wrong number this repo exists to prevent.
    expect(form).toContain('placeholder="1"');
  });
});

// The boxes are share counts, and a share count is only meaningful against the others. Two names
// with a 1 in each said nothing about being relative, so each box states the percentage it comes to.
// It is DERIVED: 80 and 20 is the same split as 4 and 1, so the box itself cannot be a percentage.
describe("the percentage a share count comes to", () => {
  it("reads a ratio as the deal it is", () => {
    expect(sharePercents([4, 1])).toEqual(["80", "20"]);
    expect(sharePercents([80, 20])).toEqual(["80", "20"]);
  });

  it("reads equal counts as equal, where the split does not divide", () => {
    // It used to round the column to whole percents that added to 100, which read three even seats
    // as 34/33/33. The money divides evenly (splitDrop, dust to the seller), so the label was the
    // only thing on screen saying one of the three took more.
    expect(sharePercents([1, 1, 1])).toEqual(["33.33", "33.33", "33.33"]);
    expect(sharePercents([1, 1, 1, 1, 1, 1])).toEqual(Array(6).fill("16.67"));
  });

  it("gives a seat that takes nothing a nothing, since zero is a real answer", () => {
    expect(sharePercents([1, 0])).toEqual(["100", "0"]);
  });

  it("is what the form renders, rather than a column rounded to add up", () => {
    expect(form).toContain("sharePercents");
    expect(form).not.toContain("largestRemainder");
  });
});

// A bulk sale had no share boxes at all, so every pile of grindstones was written as an even split and
// reached the Settlement Ledger as one, whatever the party had agreed. bulk-sale.test.ts pins what
// the ratio does; this pins that there is somewhere to type it.
describe("the bulk-sale card's share boxes", () => {
  it("draws a box per name, one set per roster the sale covers", () => {
    expect(lot).toContain("bulkRosters(proposal.rows)");
    expect(lot).toContain("aria-label={`Shares for ${name}`}");
  });

  it("open on one share each, like every other sale", () => {
    expect(lot).toContain(
      'const shareOf = (key: string, name: string) => shares[key]?.[name] ?? "1";',
    );
    expect(lot).toContain('placeholder="1"');
  });

  it("sends what was typed, rather than pinning an even split behind it", () => {
    expect(lot).toContain("splitMethod, proposal!.rows, typed)");
  });

  it("refuses to send a ratio it could not read", () => {
    expect(lot).toContain("total !== null && sharesReadable");
  });
});
