import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activeHref, HOME_ROWS, HREFS, SECTIONS, sectionsFor } from "./section-menu";

const listedFor = (trades: boolean | undefined) =>
  sectionsFor(trades).flatMap((s) => s.items.map((i) => i.href));

const labelFor = (pathname: string) =>
  SECTIONS.flatMap((s) => s.items).find((i) => i.href === activeHref(pathname))?.label;

describe("which section a path belongs to", () => {
  it("lights the entry for its own page", () => {
    expect(labelFor("/characters")).toBe("Characters");
    expect(labelFor("/inventory")).toBe("Inventory");
    expect(labelFor("/bosses")).toBe("Boss Matrix");
    expect(labelFor("/bosses/parties")).toBe("Party View");
    expect(labelFor("/bosses/order")).toBe("Run Order");
    expect(labelFor("/bosses/split")).toBe("Drop Splitter");
    expect(labelFor("/bosses/planner")).toBe("Party Planner");
    expect(labelFor("/bosses/drops")).toBe("Drops");
    expect(labelFor("/bosses/drops/sales")).toBe("Sales");
    expect(labelFor("/bosses/drops/settlements")).toBe("Settlements");
  });

  it("keeps a nested section off its parent", () => {
    // The rule the longest-match sort exists for: /bosses/split must not also light the entry for
    // /bosses, which is a prefix of it.
    expect(labelFor("/bosses/split")).not.toBe("Boss Matrix");
    expect(labelFor("/bosses/order")).not.toBe("Boss Matrix");
    expect(labelFor("/bosses/parties")).not.toBe("Boss Matrix");
  });

  it("lights Party View for the pages that hang off it", () => {
    // Neither is listed in the menu. They still belong to Party View, and living under its path is
    // what makes them read that way with no entry of their own.
    expect(labelFor("/bosses/parties/edit")).toBe("Party View");
    expect(labelFor("/bosses/parties/abc-123")).toBe("Party View");
    // A config names itself with two segments, and a doubled character name with three. Both are
    // still one page under Party View. See lib/party-path.ts.
    expect(labelFor("/bosses/parties/tidelark/kalos-the-guardian")).toBe("Party View");
    expect(labelFor("/bosses/parties/heroic/rune/kalos-the-guardian")).toBe("Party View");
  });

  it("lights Settlements for the history, and Drops for a drop's own page", () => {
    expect(labelFor("/bosses/drops/settlements/history")).toBe("Settlements");
    expect(labelFor("/bosses/drops/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("Drops");
  });

  it("does NOT light Party View for the Drop Log", () => {
    // It moved out from under /bosses/parties when it started holding drops from bosses that have
    // no party. Left where it was, it would light a section it is not in.
    expect(labelFor("/bosses/drops")).not.toBe("Party View");
  });

  it("lights nothing on Social, which is not a section", () => {
    // Off the menu entirely, so no prefix of it may claim it either.
    expect(activeHref("/social/people")).toBeUndefined();
  });

  it("has nothing to light for a path outside every section", () => {
    expect(activeHref("/upload")).toBeUndefined();
    expect(activeHref("/")).toBeUndefined();
  });
});

describe("what the menu lists", () => {
  it("leaves the pages reached from Party View off the list", () => {
    expect(HREFS).not.toContain("/bosses/parties/edit");
  });

  it("lists the Drop Log's stages under their own heading, not under Bossing", () => {
    expect(SECTIONS.find((s) => s.items.some((i) => i.href === "/bosses/drops"))?.group).toBe(
      "Drop Log",
    );
    const dropLog = SECTIONS.find((s) => s.group === "Drop Log")!;
    expect(dropLog.items.map((i) => i.label)).toEqual(["Drops", "Sales", "Settlements"]);
    const bossing = SECTIONS.find((s) => s.group === "Bossing")!;
    expect(bossing.items.map((i) => i.label)).toEqual(["Boss Matrix", "Party View", "Run Order"]);
  });

  it("lists only the Drops in a world with nothing to trade", () => {
    const dropLog = sectionsFor(false).find((s) => s.group === "Drop Log")!;
    expect(dropLog.items.map((i) => i.label)).toEqual(["Drops"]);
  });

  it("lists the sections a person navigates between", () => {
    expect(HREFS).toEqual([
      "/characters",
      "/bosses",
      "/bosses/parties",
      "/bosses/order",
      "/bosses/drops",
      "/bosses/drops/sales",
      "/bosses/drops/settlements",
      "/inventory",
      "/bosses/planner",
      "/bosses/split",
    ]);
  });
});

describe("what the welcome-back screen offers", () => {
  it("names the rows in the order it draws them", () => {
    expect(HOME_ROWS.map((r) => r.label)).toEqual([
      "Characters",
      "Bossing",
      "Drop Log",
      "Inventory",
    ]);
  });

  it("folds the boss views and Run Order under Bossing, which is not a page", () => {
    const bossing = HOME_ROWS.find((r) => r.label === "Bossing")!;
    expect(bossing.href).toBeUndefined();
    expect(bossing.items.map((i) => i.label)).toEqual(["Boss Matrix", "Party View", "Run Order"]);
  });

  it("takes every label from the menu, so the two cannot drift apart", () => {
    // The point of resolving them rather than writing them twice. A rename in SECTIONS lands here
    // by itself; a label typed here again would quietly keep the old word.
    const items = SECTIONS.flatMap((s) => s.items);
    for (const row of HOME_ROWS) {
      // The Drop Log row opens its first stage and is named after its heading.
      const group = SECTIONS.find((s) => s.items.some((i) => i.href === row.href))?.group;
      if (row.href && !group) expect(items.find((i) => i.href === row.href)?.label).toBe(row.label);
      else expect(SECTIONS.map((s) => s.group)).toContain(row.label);
      if (group) expect(row.label).toBe(group);
      for (const item of row.items) expect(items).toContainEqual(item);
    }
  });

  it("offers nothing the menu does not list", () => {
    for (const row of HOME_ROWS) {
      for (const href of [row.href, ...row.items.map((i) => i.href)]) {
        if (href) expect(HREFS).toContain(href);
      }
    }
  });
});

describe("what an account with nothing to trade is offered", () => {
  it("drops the Drop Splitter, which has nothing to split there", () => {
    expect(listedFor(false)).not.toContain("/bosses/split");
    expect(listedFor(false)).toContain("/bosses/parties");
  });

  it("still routes the page it stopped listing", () => {
    // Off the menu is not gone. A bookmark or an old link has to keep working, and activeHref has
    // to keep resolving it to itself rather than lighting Boss Matrix.
    expect(HREFS).toContain("/bosses/split");
    expect(activeHref("/bosses/split")).toBe("/bosses/split");
  });

  it("lists everything in a trading world, and while the answer is unknown", () => {
    // Unknown draws the full menu on purpose. The Drop Splitter's dropdown is almost never opened
    // before /api/settings has answered, and an entry that appears a moment later is better than
    // one that flickers away.
    expect(listedFor(true)).toEqual(HREFS);
    expect(listedFor(undefined)).toEqual(HREFS);
  });

  it("keeps the Bossing heading, which still has entries under it", () => {
    // The empty-group filter exists for the day a whole section is Interactive-only. It must not
    // fire while something is left, or the remaining links lose their heading.
    expect(sectionsFor(false).some((s) => s.group === "Bossing")).toBe(true);
  });
});

describe("every destination can be shown before it has loaded", () => {
  // A route with no loading.tsx holds the PREVIOUS page on screen until its own JS has mounted,
  // however early it was prefetched. /characters shipped that way and was the one menu entry that
  // could not answer a click. Checked here rather than by eye: adding a section is adding a link,
  // and nothing about writing that link suggests a second file is owed.
  //
  // The Drop Log's stages sit in a route group, (log), whose layout they share. The boundary is the
  // group's, one level up: inside it the layout stays put and there is nothing to wait for.
  const DROP_LOG = join(__dirname, "..", "app", "bosses", "drops");
  it.each(HREFS)("has a loading boundary: %s", (href) => {
    const segments = href.split("/").filter(Boolean);
    const grouped = href.startsWith("/bosses/drops");
    const dir = grouped
      ? join(DROP_LOG, "(log)", ...segments.slice(2))
      : join(__dirname, "..", "app", ...segments);
    expect(existsSync(join(dir, "page.tsx"))).toBe(true);
    expect(existsSync(join(grouped ? DROP_LOG : dir, "loading.tsx"))).toBe(true);
  });
});
