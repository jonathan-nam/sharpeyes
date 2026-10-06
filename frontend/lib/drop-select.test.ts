import { describe, expect, it } from "vitest";
import { OTHER } from "./drop-picker";
import { PLACEHOLDER, dropOptions, nextOption, panelPlacement } from "./drop-select";
import type { BossDrop } from "@/types/drop";

const drop = (over: Partial<BossDrop> = {}): BossDrop => ({
  dropKey: "grindstone",
  name: "Grindstone of Life",
  iconUrl: "/drop-icons/grindstone.png",
  perMember: null,
  worlds: null,
  quantity: 1,
  fungible: true,
  pieces: {},
  bundles: {},
  ...over,
});

describe("dropOptions", () => {
  it("offers the boss's drops and the escape hatch", () => {
    const options = dropOptions([drop()], "INTERACTIVE");
    expect(options.map((o) => o.value)).toEqual(["grindstone", OTHER]);
  });

  // The bug: the placeholder was carried into the list as row 0, so an instruction sat where a
  // choice goes. It belongs to the closed control only.
  it("never offers the placeholder as something to choose", () => {
    const options = dropOptions([drop()], "INTERACTIVE");
    expect(options.map((o) => o.value)).not.toContain(PLACEHOLDER.value);
    expect(options.map((o) => o.label)).not.toContain(PLACEHOLDER.label);
  });

  // What makes the field draw no icon frame at all: Icon renders nothing without a URL, and only a
  // list row substitutes the blank. An icon here would put an empty box beside the instruction.
  it("gives the placeholder no art to draw", () => {
    expect(PLACEHOLDER.iconUrl).toBeNull();
  });

  it("carries the icon through, and a null one as null rather than dropping the row", () => {
    const options = dropOptions([drop(), drop({ dropKey: "unknown", iconUrl: null })], "HEROIC");
    expect(options[0]?.iconUrl).toBe("/drop-icons/grindstone.png");
    expect(options[1]).toMatchObject({ value: "unknown", iconUrl: null });
  });

  it("labels a per-member drop the way the select did, so the copy did not change", () => {
    const options = dropOptions([drop({ perMember: "ALWAYS" })], "INTERACTIVE");
    expect(options[0]?.label).toBe("Grindstone of Life (one each)");
  });

  it("offers only the escape hatch for a boss with no table", () => {
    expect(dropOptions([], "INTERACTIVE").map((o) => o.value)).toEqual([OTHER]);
  });
});

describe("nextOption", () => {
  it("wraps both ways", () => {
    expect(nextOption(2, 3, 1)).toBe(0);
    expect(nextOption(0, 3, -1)).toBe(2);
  });

  it("holds at 0 for an empty list rather than returning -1 or NaN", () => {
    expect(nextOption(0, 0, 1)).toBe(0);
  });
});

// A trigger 30px tall, so `bottom` is `top + 30`.
const trigger = (top: number) => ({ top, bottom: top + 30, left: 40, width: 220 });
const viewport = { width: 1000, height: 800 };

describe("panelPlacement", () => {
  it("opens downward from the trigger when there is room", () => {
    const at = panelPlacement(trigger(100), viewport);
    expect(at).toMatchObject({ top: 130, left: 40, width: 220 });
    expect(at.maxHeight).toBe(800 - 130 - 8);
  });

  it("opens upward when the space below is too small to be a list", () => {
    // 40px below, 690 above: downward would be a two-row window against the bottom edge.
    const at = panelPlacement(trigger(720), viewport);
    expect(at).toMatchObject({ bottom: 800 - 720 });
    expect(at).not.toHaveProperty("top");
    expect(at.maxHeight).toBe(720 - 8);
  });

  it("stays downward when neither side has room, taking the bigger half", () => {
    // A short viewport: 90 below beats 60 above, and clamping to zero is not a negative height.
    const at = panelPlacement(trigger(60), { width: 1000, height: 180 });
    expect(at).toMatchObject({ top: 90 });
    expect(at.maxHeight).toBeGreaterThan(0);
  });

  it("never reports a negative height, whichever way it opens", () => {
    for (const top of [-50, 0, 400, 800, 2000]) {
      expect(panelPlacement(trigger(top), viewport).maxHeight).toBeGreaterThanOrEqual(0);
    }
  });

  it("pulls a panel back inside the right edge instead of overhanging it", () => {
    // The picker sits in a wide row on a narrow window: 900 + 220 would run 120px off screen.
    expect(panelPlacement({ ...trigger(100), left: 900 }, viewport).left).toBe(1000 - 220 - 8);
  });

  it("leaves the left edge alone when the trigger is already at it", () => {
    expect(panelPlacement({ ...trigger(100), left: 2 }, viewport).left).toBe(8);
  });
});
