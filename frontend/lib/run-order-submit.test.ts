import { describe, expect, it } from "vitest";
import { controlsKey, type NightControls } from "@/lib/run-order-submit";

const NIGHT: NightControls = {
  openOnly: true,
  everyoneOn: true,
  timed: true,
  away: ["you"],
  windows: { you: { from: "+1", until: "" } },
  startText: "+0.5",
  endText: null,
  duration: 120,
};

function keyWith(change: Partial<NightControls>): string {
  return controlsKey({ ...NIGHT, ...change });
}

describe("the night a run order was built from", () => {
  it("is the same night whatever order people were ticked off in", () => {
    expect(keyWith({ away: ["you", "b8a"] })).toBe(keyWith({ away: ["b8a", "you"] }));
  });

  it("is the same night when a window box is opened and left empty", () => {
    expect(keyWith({ windows: { ...NIGHT.windows, b8a: { from: "", until: "" } } })).toBe(
      controlsKey(NIGHT),
    );
  });

  // The start of the night follows the clock until it is typed over. Keying on the resolved
  // minute would call the plan out of date on its own, with nothing on the page changed.
  it("says nothing about the clock the plan was asked for at", () => {
    expect(controlsKey(NIGHT)).not.toContain("startAt");
    expect(controlsKey(NIGHT)).not.toContain("budget");
  });

  for (const [what, change] of [
    ["somebody going away", { away: ["you", "b8a"] }],
    ["somebody coming back", { away: [] }],
    ["a window", { windows: { you: { from: "+2", until: "" } } }],
    ["the cleared filter", { openOnly: false }],
    ["the everyone-on filter", { everyoneOn: false }],
    ["the clock going off", { timed: false }],
    ["a start being typed", { startText: "+2" }],
    ["an end being typed", { endText: "+4" }],
    ["a preset", { duration: 180 }],
  ] as [string, Partial<NightControls>][]) {
    it(`is a different night after ${what}`, () => {
      expect(keyWith(change)).not.toBe(controlsKey(NIGHT));
    });
  }
});
