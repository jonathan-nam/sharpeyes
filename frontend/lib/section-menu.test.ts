import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeHref,
  HOME_ACTIONS,
  HOME_HREFS,
  HREFS,
  MENU_HREFS,
  SECTIONS,
  sectionsFor,
} from "./section-menu";

const listedFor = (trades: boolean | undefined) =>
  sectionsFor(trades).flatMap((s) => s.items.filter((i) => !i.hidden).map((i) => i.href));

const labelFor = (pathname: string) =>
  SECTIONS.flatMap((s) => s.items).find((i) => i.href === activeHref(pathname))?.label;

describe("which section a path belongs to", () => {
  it("lights the entry for its own page", () => {
    expect(labelFor("/characters")).toBe("Characters");
    expect(labelFor("/inventory")).toBe("Inventory");
    expect(labelFor("/bosses")).toBe("Individual View");
    expect(labelFor("/bosses/parties")).toBe("Party View");
    expect(labelFor("/bosses/order")).toBe("Run Order");
    expect(labelFor("/bosses/split")).toBe("Split Utility");
    expect(labelFor("/bosses/drops")).toBe("Drop Log");
  });

  it("keeps a nested section off its parent", () => {
    // The rule the longest-match sort exists for: /bosses/split must not also light the entry for
    // /bosses, which is a prefix of it.
    expect(labelFor("/bosses/split")).not.toBe("Individual View");
    expect(labelFor("/bosses/order")).not.toBe("Individual View");
    expect(labelFor("/bosses/parties")).not.toBe("Individual View");
  });

  it("lights Party View for the pages that hang off it", () => {
    // Neither is listed in the menu. They still belong to Party View, and living under its path is
    // what makes them read that way with no entry of their own.
    expect(labelFor("/bosses/parties/edit")).toBe("Party View");
    expect(labelFor("/bosses/parties/abc-123")).toBe("Party View");
    // A config names itself with two segments, and a doubled character name with three. Both are
    // still one page under Party View. See lib/party-path.ts.
    expect(labelFor("/bosses/parties/mechyfechy/kalos-the-guardian")).toBe("Party View");
    expect(labelFor("/bosses/parties/heroic/rune/kalos-the-guardian")).toBe("Party View");
  });

  it("does NOT light Party View for the Drop Log", () => {
    // It moved out from under /bosses/parties when it started holding drops from bosses that have
    // no party. Left where it was, it would light a section it is not in.
    expect(labelFor("/bosses/drops")).not.toBe("Party View");
  });

  it("does NOT light Individual View for People", () => {
    // The trap this file is here for. People was dropped from the menu; without a hidden entry
    // holding its path, the longest match falls back to /bosses and the hamburger claims you are
    // on Individual View. Nothing errors, it just says something untrue.
    expect(activeHref("/bosses/people")).toBe("/bosses/people");
    expect(labelFor("/bosses/people")).not.toBe("Individual View");
  });

  it("has nothing to light for a path outside every section", () => {
    expect(activeHref("/upload")).toBeUndefined();
    expect(activeHref("/")).toBeUndefined();
  });
});

describe("what the menu lists", () => {
  it("leaves the pages reached from Party View off the list", () => {
    expect(MENU_HREFS).not.toContain("/bosses/parties/edit");
    expect(MENU_HREFS).not.toContain("/bosses/people");
  });

  it("still routes the hidden ones", () => {
    // Listed and routed are different sets, and the hidden entry has to stay in the second.
    expect(HREFS).toContain("/bosses/people");
    expect(HREFS.length).toBeGreaterThan(MENU_HREFS.length);
  });

  it("lists the sections a person navigates between", () => {
    expect(MENU_HREFS).toEqual([
      "/characters",
      "/bosses",
      "/bosses/parties",
      "/bosses/drops",
      "/bosses/order",
      "/bosses/split",
      "/inventory",
    ]);
  });
});

describe("what the welcome-back screen offers", () => {
  it("names the sections in the order it draws them", () => {
    expect(HOME_ACTIONS.map((i) => i.label)).toEqual([
      "Characters",
      "Inventory",
      "Individual View",
      "Party View",
      "Drop Log",
    ]);
  });

  it("takes every label from the menu, so the two cannot drift apart", () => {
    // The point of resolving them rather than writing them twice. A rename in SECTIONS lands here
    // by itself; a label typed here again would quietly keep the old word.
    for (const item of HOME_ACTIONS) {
      expect(SECTIONS.flatMap((s) => s.items)).toContainEqual(item);
    }
  });

  it("offers nothing the menu does not list", () => {
    // A button to a hidden page would be the only door to it, which is not what this screen is.
    for (const href of HOME_HREFS) expect(MENU_HREFS).toContain(href);
  });
});

describe("what an account with nothing to trade is offered", () => {
  it("drops the Split Utility, which has nothing to split there", () => {
    expect(listedFor(false)).not.toContain("/bosses/split");
    expect(listedFor(false)).toContain("/bosses/parties");
  });

  it("still routes the page it stopped listing", () => {
    // Off the menu is not gone. A bookmark or an old link has to keep working, and activeHref has
    // to keep resolving it to itself rather than lighting Individual View.
    expect(HREFS).toContain("/bosses/split");
    expect(activeHref("/bosses/split")).toBe("/bosses/split");
  });

  it("lists everything in a trading world, and while the answer is unknown", () => {
    // Unknown draws the full menu on purpose. The panel does not mount until the hamburger is
    // clicked, which is almost always after /api/settings has answered, and an entry that appears
    // a moment later is better than one that flickers away.
    expect(listedFor(true)).toEqual(MENU_HREFS);
    expect(listedFor(undefined)).toEqual(MENU_HREFS);
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
  it.each(HREFS)("has a loading boundary: %s", (href) => {
    const dir = join(__dirname, "..", "app", ...href.split("/").filter(Boolean));
    expect(existsSync(join(dir, "page.tsx"))).toBe(true);
    expect(existsSync(join(dir, "loading.tsx"))).toBe(true);
  });
});

describe("every hidden entry has a way in", () => {
  // A hidden entry is not on the hamburger, so a link on some other page is its ONLY door. Deleting
  // that link breaks no build and fails no route test, it just leaves a page nothing reaches. The
  // page's own files are excluded, or its back link would count as the way in.
  const HIDDEN = HREFS.filter((href) => !MENU_HREFS.includes(href));

  const tsxUnder = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return tsxUnder(path);
      return entry.name.endsWith(".tsx") ? [path] : [];
    });

  const sources = [join(__dirname, "..", "app"), join(__dirname, "..", "components")]
    .flatMap(tsxUnder)
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("has hidden entries to check", () => {
    // The guard below passes trivially on an empty list, and the list is derived.
    expect(HIDDEN.length).toBeGreaterThan(0);
  });

  it.each(HIDDEN)("is linked from another page: %s", (href) => {
    const own = join(__dirname, "..", "app", ...href.split("/").filter(Boolean));
    const linked = sources
      .filter((file) => !file.path.startsWith(own))
      .filter((file) => file.text.includes(`href="${href}"`))
      .map((file) => file.path);
    expect(linked).not.toEqual([]);
  });
});
