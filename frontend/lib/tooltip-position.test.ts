import { describe, expect, it } from "vitest";

import { placeTip } from "./tooltip-position";

const viewport = { width: 800, height: 600 };
const tip = { width: 100, height: 30 };

describe("placeTip", () => {
  it("centres above the anchor when there is room", () => {
    const at = placeTip({ top: 200, left: 300, width: 40, height: 20 }, tip, viewport);
    expect(at).toEqual({ top: 164, left: 270, below: false });
  });

  it("flips below an anchor at the top of the screen", () => {
    const at = placeTip({ top: 10, left: 300, width: 40, height: 20 }, tip, viewport);
    expect(at).toEqual({ top: 36, left: 270, below: true });
  });

  it("opens below when asked and there is room", () => {
    const at = placeTip({ top: 200, left: 300, width: 40, height: 20 }, tip, viewport, "below");
    expect(at.below).toBe(true);
  });

  it("goes above when below does not fit, even when asked for below", () => {
    const at = placeTip({ top: 580, left: 300, width: 40, height: 10 }, tip, viewport, "below");
    expect(at.below).toBe(false);
  });

  it("keeps clear of both side edges", () => {
    expect(placeTip({ top: 200, left: 0, width: 20, height: 20 }, tip, viewport).left).toBe(8);
    expect(placeTip({ top: 200, left: 790, width: 10, height: 20 }, tip, viewport).left).toBe(692);
  });

  it("takes the roomier side when neither fits", () => {
    const tall = { width: 100, height: 400 };
    expect(placeTip({ top: 100, left: 300, width: 40, height: 20 }, tall, viewport).below).toBe(
      true,
    );
    expect(placeTip({ top: 450, left: 300, width: 40, height: 20 }, tall, viewport).below).toBe(
      false,
    );
  });
});
