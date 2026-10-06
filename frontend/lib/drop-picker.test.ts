import { describe, expect, it } from "vitest";
import {
  MAX_QUANTITY,
  OTHER,
  addDropBody,
  defaultQuantity,
  dropOptionLabel,
  parseQuantity,
  pickableDrops,
} from "./drop-picker";
import type { BossDrop } from "@/types/drop";

function drop(overrides: Partial<BossDrop> = {}): BossDrop {
  return {
    dropKey: "grindstone",
    name: "Grindstone of Life",
    iconUrl: null,
    perMember: null,
    worlds: null,
    quantity: 1,
    fungible: false,
    pieces: {},
    bundles: {},
    ...overrides,
  };
}

describe("what the picker may offer", () => {
  it("offers an unnarrowed drop in both worlds", () => {
    const table = [drop()];
    expect(pickableDrops(table, "INTERACTIVE")).toHaveLength(1);
    expect(pickableDrops(table, "HEROIC")).toHaveLength(1);
  });

  it("keeps an Interactive-only drop out of a Heroic party", () => {
    // The whole point of the filter: a picker that offers it there is offering to log a drop
    // that cannot happen.
    const table = [drop(), drop({ dropKey: "coupon", worlds: "INTERACTIVE" })];
    expect(pickableDrops(table, "HEROIC").map((d) => d.dropKey)).toEqual(["grindstone"]);
    expect(pickableDrops(table, "INTERACTIVE")).toHaveLength(2);
  });

  it("is empty for a boss with no table, rather than throwing", () => {
    expect(pickableDrops(undefined, "INTERACTIVE")).toEqual([]);
  });

  it("keeps a counted drop off the modes it does not fall at", () => {
    // Kalos gives the fragment on Normal and the token on Chaos and Extreme, so an Extreme run
    // that offers the fragment is offering to log one that cannot happen.
    const fragment = drop({
      dropKey: "kalos-fragment",
      pieces: { INTERACTIVE: { NORMAL: 3 }, HEROIC: { NORMAL: 2 } },
    });
    const token = drop({
      dropKey: "kalos-token",
      pieces: { INTERACTIVE: { CHAOS: 5, EXTREME: 14 }, HEROIC: { CHAOS: 2, EXTREME: 3 } },
    });
    const table = [drop(), fragment, token];

    expect(pickableDrops(table, "INTERACTIVE", "EXTREME").map((d) => d.dropKey)).toEqual([
      "grindstone",
      "kalos-token",
    ]);
    expect(pickableDrops(table, "HEROIC", "NORMAL").map((d) => d.dropKey)).toEqual([
      "grindstone",
      "kalos-fragment",
    ]);
  });

  it("keeps an uncounted drop on every mode", () => {
    // A table is per boss, not per (boss, difficulty). Nothing in the catalog says which modes a
    // grindstone falls at, and a filter that guessed would hide a drop that cannot be entered
    // any other way. This is the Grindstone of Life on Kaling.
    const table = [drop()];
    for (const mode of ["EASY", "NORMAL", "HARD", "CHAOS", "EXTREME"]) {
      expect(pickableDrops(table, "INTERACTIVE", mode)).toHaveLength(1);
    }
  });

  it("narrows nothing when nobody has said which mode", () => {
    const table = [drop(), drop({ dropKey: "coupon", pieces: { INTERACTIVE: { EXTREME: 480 } } })];
    expect(pickableDrops(table, "INTERACTIVE")).toHaveLength(2);
    expect(pickableDrops(table, "INTERACTIVE", null)).toHaveLength(2);
  });

  it("reads the mode against the party's OWN world", () => {
    // A count of zero never reaches the catalog, so a drop that falls in one world and not the
    // other is missing that (world, mode) pair rather than carrying a zero there.
    const table = [drop({ dropKey: "coupon", pieces: { INTERACTIVE: { HARD: 6 }, HEROIC: {} } })];
    expect(pickableDrops(table, "INTERACTIVE", "HARD")).toHaveLength(1);
    expect(pickableDrops(table, "INTERACTIVE", "NORMAL")).toHaveLength(0);
  });

  it("offers a drop in a world it has no figures for at all", () => {
    // Not the same as a mode missing from a world that HAS figures: here the catalog says nothing
    // about the pair, and silence is not a refusal.
    const table = [drop({ dropKey: "coupon", pieces: { INTERACTIVE: { EXTREME: 480 } } })];
    expect(pickableDrops(table, "HEROIC", "NORMAL")).toHaveLength(1);
  });

  it("survives an answer from before amounts existed", () => {
    // pieces absent rather than empty, which is what a cached older response looks like.
    const older = { ...drop() } as Partial<BossDrop>;
    delete older.pieces;
    expect(pickableDrops([older as BossDrop], "INTERACTIVE", "EXTREME")).toHaveLength(1);
  });
});

describe("how an option reads", () => {
  it("says so when everybody gets one", () => {
    expect(dropOptionLabel(drop({ perMember: "ALWAYS" }), "INTERACTIVE")).toBe(
      "Grindstone of Life (one each)",
    );
  });

  it("asks the world about a HEROIC-only per-member drop", () => {
    const d = drop({ perMember: "HEROIC" });
    expect(dropOptionLabel(d, "HEROIC")).toBe("Grindstone of Life (one each)");
    expect(dropOptionLabel(d, "INTERACTIVE")).toBe("Grindstone of Life");
  });
});

describe("what the picker posts", () => {
  it("refuses an unanswered picker", () => {
    expect(addDropBody("kalos", "", "")).toBeNull();
  });

  it("refuses 'something else' with nothing typed, whitespace included", () => {
    expect(addDropBody("kalos", OTHER, "")).toBeNull();
    expect(addDropBody("kalos", OTHER, "   ")).toBeNull();
  });

  it("sends the drop key, and no custom name beside it", () => {
    // Exactly one name: the server rejects both, and both would leave two answers to what the
    // row is.
    expect(addDropBody("kalos", "grindstone", "ignored")).toEqual({
      bossKey: "kalos",
      dropKey: "grindstone",
      customName: null,
      quantity: 1,
    });
  });

  it("sends a trimmed custom name, and no drop key beside it", () => {
    expect(addDropBody("kalos", OTHER, "  Some Cape  ")).toEqual({
      bossKey: "kalos",
      dropKey: null,
      customName: "Some Cape",
      quantity: 1,
    });
  });

  it("refuses a drop with no boss, however complete the rest of it is", () => {
    // The Drop Log picks the boss, so an empty key there is a question not yet answered. Posting
    // it would file a drop nothing can find: the pool is resolved from the boss.
    expect(addDropBody("", "grindstone", "")).toBeNull();
    expect(addDropBody("", OTHER, "Some Cape")).toBeNull();
  });
});

describe("how many fell", () => {
  it("reads a blank count as one, so a single item takes no typing", () => {
    expect(parseQuantity("")).toBe(1);
    expect(parseQuantity("  ")).toBe(1);
  });

  it("reads a count as typed, commas included", () => {
    expect(parseQuantity("180")).toBe(180);
    expect(parseQuantity("1,080")).toBe(1080);
  });

  it("refuses what it cannot read rather than falling back to one", () => {
    // A count that quietly became 1 would file 180 coupons as a single one, and the sale beside it
    // would look like the price of one.
    for (const bad of ["18O", "-1", "0", "1.5", "abc", String(MAX_QUANTITY + 1)]) {
      expect(parseQuantity(bad)).toBeNull();
    }
  });

  it("carries the count into what the picker posts, and refuses a body it cannot count", () => {
    expect(addDropBody("kalos", "grindstone", "", "180")?.quantity).toBe(180);
    expect(addDropBody("kalos", OTHER, "Some Cape", "6")?.quantity).toBe(6);
    expect(addDropBody("kalos", "grindstone", "", "18O")).toBeNull();
  });
});

describe("the count the box opens with", () => {
  const vestige = drop({
    dropKey: "vestige-of-erion",
    name: "Vestige of Erion Coupon",
    pieces: { INTERACTIVE: { HARD: 60, EXTREME: 480 } },
  });

  it("fills the boss's own figure for the difficulty being run", () => {
    expect(defaultQuantity(vestige, "EXTREME", "INTERACTIVE")).toBe("480");
    expect(defaultQuantity(vestige, "HARD", "INTERACTIVE")).toBe("60");
  });

  it("fills nothing for a difficulty that drops none", () => {
    // Only the difficulties in the tables drop them, and a pre-filled zero would be a claim the
    // catalog does not make.
    expect(defaultQuantity(vestige, "NORMAL", "INTERACTIVE")).toBe("");
    expect(defaultQuantity(vestige, "EASY", "INTERACTIVE")).toBe("");
  });

  it("fills nothing when nobody has said which difficulty", () => {
    // A config with no difficulty, and the Drop Log, which never asks for one.
    expect(defaultQuantity(vestige, null, "INTERACTIVE")).toBe("");
    expect(defaultQuantity(vestige, undefined, "INTERACTIVE")).toBe("");
  });

  it("fills nothing for a drop that has no amounts, or no drop at all", () => {
    expect(defaultQuantity(drop(), "EXTREME", "INTERACTIVE")).toBe("");
    expect(defaultQuantity(undefined, "EXTREME", "INTERACTIVE")).toBe("");
  });

  it("survives an answer from before amounts existed", () => {
    // pieces absent rather than empty, which is what a cached older response looks like.
    const older = { ...drop() } as Partial<typeof vestige>;
    delete older.pieces;
    expect(defaultQuantity(older as typeof vestige, "EXTREME", "INTERACTIVE")).toBe("");
  });

  it("fills the count for the party's OWN world", () => {
    // Chaos Kalos gives 5 pieces to the whole party on Interactive and 2 to each member on Heroic,
    // and Extreme 14 against 3. Neither is a multiple of the other, so reading the wrong world is
    // not an approximation, it is a different number wearing the right name.
    //
    // This is the read that broke silently when the world was added above the difficulty:
    // `pieces[difficulty]` still type-checked, still returned something, and String() turned the
    // map it now got into a value the box would have shown.
    const token = drop({
      dropKey: "kalos-token",
      name: "Kalos's Residual Determination",
      pieces: { INTERACTIVE: { CHAOS: 5, EXTREME: 14 }, HEROIC: { CHAOS: 2, EXTREME: 3 } },
    });

    expect(defaultQuantity(token, "CHAOS", "INTERACTIVE")).toBe("5");
    expect(defaultQuantity(token, "CHAOS", "HEROIC")).toBe("2");
    expect(defaultQuantity(token, "EXTREME", "INTERACTIVE")).toBe("14");
    expect(defaultQuantity(token, "EXTREME", "HEROIC")).toBe("3");
  });

  it("fills nothing for a world the drop has no count in", () => {
    // Not zero, and not the other world's figure. The catalog says nothing about this pair.
    expect(defaultQuantity(vestige, "EXTREME", "HEROIC")).toBe("");
  });
});
