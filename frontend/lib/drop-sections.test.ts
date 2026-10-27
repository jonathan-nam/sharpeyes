import { describe, expect, it } from "vitest";
import {
  cardFromQuery,
  dropSections,
  homeSections,
  saleCards,
  sectionFromPath,
  sectionHref,
  sectionSteps,
  settlementCardHref,
  shownSection,
} from "./drop-sections";

const none = { unanswered: 0, holders: 0, bulk: 0, rows: 0 };
const keys = (trades?: boolean) => dropSections(trades).map((s) => s.key);

describe("how many cards the Sale Ledger holds", () => {
  it("counts every unanswered night as the one card that answers them", () => {
    expect(saleCards({ ...none, unanswered: 4 })).toBe(1);
  });

  it("counts a card per holder and per pile", () => {
    expect(saleCards({ unanswered: 2, holders: 3, bulk: 2, rows: 0 })).toBe(6);
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

  // The heading is drawn on `sections.length > 1`, on the page and in the skeleton alike.
  it("leaves nothing to choose between, which is what takes the heading off screen", () => {
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
  // keep drawing a stage the world does not have.
  it("falls back to the drops when the world drops the chosen stage", () => {
    for (const key of ["sales", "settlement", "settled"] as const) {
      expect(shownSection(key, dropSections(false))).toBe("drops");
    }
  });
});

describe("linking straight to a stage", () => {
  it("opens on the stage the link names", () => {
    for (const { key } of dropSections()) {
      expect(sectionFromPath(sectionHref(key))).toBe(key);
      expect(sectionFromPath(`${sectionHref(key)}/`)).toBe(key);
    }
  });

  it("reads a drop's own page as no stage", () => {
    expect(sectionFromPath("/bosses/drops/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBeUndefined();
  });

  // The header lights the longest href a path starts with, so the history must sit under
  // Settlements to light it, and every stage under the Drop Log.
  it("nests the history under Settlements", () => {
    expect(sectionHref("settled").startsWith(`${sectionHref("settlement")}/`)).toBe(true);
    for (const { key } of dropSections()) {
      expect(sectionHref(key).startsWith(sectionHref("drops"))).toBe(true);
    }
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
    expect(sectionFromPath(url.pathname)).toBe("settlement");
    expect(cardFromQuery(url.search)).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });

  it("names no card on a plain stage link", () => {
    expect(cardFromQuery(new URL(sectionHref("settlement"), "http://x").search)).toBeUndefined();
  });
});

describe("the links either side of a stage", () => {
  const steps = (key: Parameters<typeof sectionSteps>[0], trades?: boolean) => {
    const { back, next } = sectionSteps(key, dropSections(trades));
    return [back?.key, next?.key];
  };

  it("walks the pipeline, ending at the history", () => {
    expect(steps("drops")).toEqual([undefined, "sales"]);
    expect(steps("sales")).toEqual(["drops", "settlement"]);
    expect(steps("settlement")).toEqual(["sales", "settled"]);
    expect(steps("settled")).toEqual(["settlement", undefined]);
  });

  it("offers a Heroic world nowhere to go", () => {
    expect(steps("drops", false)).toEqual([undefined, undefined]);
  });
});

describe("an old ?section= link", () => {
  it("redirects to the stage's own page", async () => {
    const { default: config } = await import("../next.config");
    const redirects = await config.redirects!();
    for (const { key } of dropSections()) {
      if (key === "drops") continue;
      const rule = redirects.find(
        (r) => r.source === "/bosses/drops" && r.has?.some((h) => "value" in h && h.value === key),
      );
      expect(rule?.destination, key).toBe(sectionHref(key));
    }
  });
});
