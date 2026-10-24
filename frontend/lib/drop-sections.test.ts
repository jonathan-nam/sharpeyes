import { describe, expect, it } from "vitest";
import {
  cardFromQuery,
  dropSections,
  homeSections,
  saleCards,
  sectionFromQuery,
  sectionHref,
  settlementCardHref,
  shownSection,
} from "./drop-sections";

const none = { unanswered: 0, holders: 0, lots: 0, rows: 0 };
const keys = (trades?: boolean) => dropSections(trades).map((s) => s.key);

describe("how many cards the Sale Ledger holds", () => {
  it("counts every unanswered night as the one card that answers them", () => {
    expect(saleCards({ ...none, unanswered: 4 })).toBe(1);
  });

  it("counts a card per holder and per pile", () => {
    expect(saleCards({ unanswered: 2, holders: 3, lots: 2, rows: 0 })).toBe(6);
  });

  it("counts a card per drop that prices alone", () => {
    // A ring is one card and never a queue, so three of them are three cards. See rowSales.
    expect(saleCards({ ...none, rows: 3 })).toBe(3);
  });
});

describe("which sections the page has", () => {
  it("offers all four, whatever is behind them", () => {
    // They used to come and go with their contents, which took a tab out from under the reader as
    // they recorded the last thing on it and hid a ledger nobody had ever had anything on.
    expect(keys()).toEqual(["drops", "sales", "settlement", "settled"]);
  });

  it("offers the same four when the account is empty", () => {
    expect(saleCards(none)).toBe(0);
    expect(keys()).toEqual(["drops", "sales", "settlement", "settled"]);
  });

  it("puts them in pipeline order, which is the order a drop moves through them", () => {
    // The tabs ARE the stages, so reading them left to right is reading what happens to a drop.
    // Settled last because nothing leaves it.
    expect(keys().indexOf("settled")).toBe(keys().length - 1);
  });
});

describe("which sections a Heroic world has", () => {
  // Nothing changes hands in Heroic, so three of the four stages cannot happen there. The pools
  // behind them are narrowed to the shown world server-side, so these are not tabs that happen to
  // be empty, they are tabs that cannot fill.
  it("offers the Drop Ledger alone", () => {
    expect(keys(false)).toEqual(["drops"]);
  });

  // The strip is drawn on `sections.length > 1`, on the page and in the skeleton alike, so one
  // section means no tabs at all rather than a strip with nothing to choose between.
  it("leaves nothing to choose between, which is what takes the strip off screen", () => {
    expect(dropSections(false)).toHaveLength(1);
  });

  it("keeps all four while the world is still unknown", () => {
    // Undefined is the moment before /api/settings answers, not a third world.
    expect(keys(undefined)).toEqual(keys(true));
  });
});

describe("which section to draw", () => {
  it("draws the chosen one", () => {
    expect(shownSection("sales", dropSections())).toBe("sales");
    expect(shownSection("settlement", dropSections())).toBe("settlement");
    expect(shownSection("settled", dropSections())).toBe("settled");
  });

  // The guard is now against a key that is not a section at all, from a stale cached value rather
  // than from a tab that went away.
  it("falls back to the drops for a key that is not a section", () => {
    expect(shownSection("nonsense" as never, dropSections())).toBe("drops");
  });

  // Toggling the header to Heroic while standing on the Sale Ledger. Without this the page would
  // keep drawing a tab the world does not have, with no strip left to leave it by.
  it("falls back to the drops when the world drops the chosen tab", () => {
    for (const key of ["sales", "settlement", "settled"] as const) {
      expect(shownSection(key, dropSections(false))).toBe("drops");
    }
  });
});

describe("linking straight to a stage", () => {
  it("opens on the stage the link names", () => {
    for (const { key } of dropSections()) {
      const url = new URL(sectionHref(key), "http://x");
      expect(shownSection(sectionFromQuery(url.search) ?? "drops", dropSections())).toBe(key);
    }
  });

  it("ignores a section that is not a stage", () => {
    expect(sectionFromQuery("?section=wallet")).toBeUndefined();
    expect(sectionFromQuery("")).toBeUndefined();
  });

  it("offers the home screen every stage but Settled", () => {
    expect(homeSections().map((s) => s.key)).toEqual(["drops", "sales", "settlement"]);
  });

  it("offers a Heroic home screen the drops alone", () => {
    expect(homeSections(false).map((s) => s.key)).toEqual(["drops"]);
  });
});

describe("linking straight to one Settlement card", () => {
  it("opens the Settlement stage and names the card the page scrolls to", () => {
    const url = new URL(settlementCardHref("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), "http://x");
    expect(sectionFromQuery(url.search)).toBe("settlement");
    expect(cardFromQuery(url.search)).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });

  it("names no card on a plain stage link", () => {
    expect(cardFromQuery(new URL(sectionHref("settlement"), "http://x").search)).toBeUndefined();
  });
});
