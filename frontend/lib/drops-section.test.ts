import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// What FELL is headed as a drop, and the standing split is a block of its own.
//
// A Party View row's panel used to head the week's coupons with the config's own title, inside the
// config's frame: "Vestige of Erion Config" over a stack of 180 that had already dropped. Read as a
// setting rather than as the week's biggest drop, which is the report this pins ("make it a bit more
// obvious that the Vestiges are part of the drops for the week").
//
// Source tests, because there is no component render harness here: the same approach as
// piece-row-guard.test.ts, and the alternative is nothing checking it at all. Whitespace is
// normalised so Prettier re-wrapping a line cannot fail this.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const list = source("components", "loot-list.tsx");
const page = source("app", "bosses", "parties", "page.tsx");

describe("the week's coupons are drops, not configuration", () => {
  it("leaves them under the drops heading rather than under one of their own", () => {
    // They took a "Coupons" heading of their own, which is the opposite of what the report asked
    // for: a second word under "Drops" made them a separate kind of thing rather than that night's
    // biggest drop. "Drops" heads the lot.
    expect(list).toContain('const couponTitle = !headed && panel ? "Drops" : null');
    expect(list).not.toContain('"Coupons"');
    // On the PANEL, not on `stacks`. The two were the same thing until the party's own page carried
    // the stack blocks too, and heading its pool "Drops" under "Loot pool" is the same word twice.
    expect(list).not.toContain('stacks ? "Drops"');
  });

  it("states the deal under the drop it is read against, once", () => {
    // Both blocks are IN the coupon row: what the night went like, then what each was entitled to.
    // On the LAST row only, or a week that dropped twice states the same standing deal twice.
    //
    // And not while the Add Drop form is drawing an editable copy of it, which is the other way the
    // same deal ends up on screen twice. See splitElsewhere.
    expect(list).toContain(
      "{stacks && !splitElsewhere && item.id === rows[rows.length - 1]?.id && (",
    );
    expect(list).toContain(
      '<h4 className="loot-group-title is-config">{stacks.entitledTitle}</h4> <StackAssign',
    );
  });

  it("keeps the deal on screen in a week nothing fell in, and frames it there", () => {
    // Off the catalog, so it can be agreed before the boss is ever run. There is no row to hang it
    // under then, so it takes the frame instead of floating between the picker and the roster.
    expect(list).toContain("{stacks && !splitElsewhere && coupons.length === 0 && (");
    expect(list).toContain(
      '<div className="loot-config-card"> <h3 className="loot-group-title is-config">' +
        "{stacks.entitledTitle}</h3> <StackAssign",
    );
    // Once only: the group of rows must not frame itself as config again, which is the arrangement
    // that had a stack of 180 reading as a setting.
    expect(list.match(/loot-config-card/g)).toHaveLength(1);
    expect(source("app", "globals.css")).toContain(".loot-config-card {");
    // And the group of rows still draws nothing when empty, which is what leaves that case to
    // LootList rather than to a heading over an empty list.
    expect(list).toContain("if (rows.length === 0) return null;");
  });

  it("names the split by what it says, and heads the rows with nothing", () => {
    expect(page).toContain('entitledTitle: "Entitled each week"');
    // No heading is handed down over the rows. The old one named our word for the row, twice over:
    // a config, of a coupon.
    expect(page).not.toContain('title: "Vestige');
  });
});
