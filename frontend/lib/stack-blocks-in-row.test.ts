import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The night's pickup and the standing split belong INSIDE the coupon row's own frame.
//
// They used to follow it as siblings in .loot-list, so the row's border closed above them and a
// stack of coupons read as a card with two loose blocks under it, with nothing saying which drop
// they were about. There are no component tests in this repo, so this reads the source, the same
// approach as piece-row-guard.test.ts.
//
// Whitespace is normalised first: matching the source as written fails the moment Prettier re-wraps
// a prop, which is a test that breaks on formatting rather than on structure.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const list = source("components", "loot-list.tsx");
const row = source("components", "loot-row.tsx");
const css = source("app", "globals.css");

describe("the stack blocks sit inside the coupon row", () => {
  it("gives the row children at all, rather than a self-closing tag", () => {
    expect(list).toContain("</LootRow>");
  });

  const inside = list.slice(list.indexOf("<LootRow"), list.indexOf("</LootRow>"));

  it("finds the row's children at all, so the guard cannot pass by finding none", () => {
    expect(inside.length).toBeGreaterThan(0);
    // One row element in the file, or the slice above spans more than the row it means to.
    expect(list.split("<LootRow").length - 1).toBe(1);
  });

  it("draws the night's pickup in it", () => {
    expect(inside).toContain("<StackPickup");
    expect(inside).toContain("pickup.title");
  });

  it("draws the standing split in it, on the last row only", () => {
    expect(inside).toContain("<StackAssign");
    expect(inside).toContain("stacks.entitledTitle");
    // The split is the PARTY's, so a week that dropped twice must not state it in both rows.
    expect(inside).toContain("item.id === rows[rows.length - 1]?.id");
  });

  it("renders those children inside the row's own frame, not after it", () => {
    const article = row.slice(row.indexOf("<article"), row.lastIndexOf("</article>"));
    expect(article).toContain("{children}");
  });

  it("still frames the split on its own when nothing fell, which has no row to sit in", () => {
    // The one case that is deliberately NOT in a row: no drop to hang under, so it keeps its card.
    expect(list).toContain("loot-config-card");
    expect(list).toContain("coupons.length === 0");
  });

  it("drops the heading's margin in the row, whose own gap spaces it", () => {
    expect(css).toContain(".loot-row .loot-group-title.is-config { margin: 0; }");
  });
});
