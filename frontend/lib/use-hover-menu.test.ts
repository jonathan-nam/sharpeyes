import { describe, expect, it } from "vitest";
import { menuAfter, type OpenedBy } from "./use-hover-menu";

const replay = (events: Parameters<typeof menuAfter>[1][], from: OpenedBy = null) =>
  events.reduce(menuAfter, from);

describe("a header menu", () => {
  it("retracts when the mouse leaves after a click", () => {
    // The usual mouse path: the rest opens it, the click lands on an open menu, the mouse moves
    // on. This stayed open when a click pinned the menu.
    expect(replay(["enter", "click", "leave"])).toBe(null);
  });

  it("retracts when the mouse leaves a hovered menu", () => {
    expect(replay(["enter", "leave"])).toBe(null);
  });

  it("stays open when a hovered menu is clicked", () => {
    expect(replay(["enter", "click"])).not.toBe(null);
  });

  it("opens and closes on clicks alone, for touch and the keyboard", () => {
    expect(replay(["click"])).not.toBe(null);
    expect(replay(["click", "click"])).toBe(null);
  });
});
