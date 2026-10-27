import { describe, expect, it } from "vitest";
import {
  canTrade,
  dropExistsIn,
  isPerMember,
  otherWorld,
  showsMoney,
  worldLabel,
  worldShortLabel,
} from "./world";

describe("what a world can do", () => {
  it("trades only in Interactive worlds", () => {
    expect(canTrade("INTERACTIVE")).toBe(true);
    expect(canTrade("HEROIC")).toBe(false);
  });

  it("carries the old name for the world players still call Reboot", () => {
    expect(worldLabel("HEROIC")).toContain("Reboot");
    expect(worldLabel("INTERACTIVE")).toBe("Interactive");
  });

  it("drops the parenthetical where both names are on screen together", () => {
    // The world toggle. "Heroic (Reboot)" beside "Interactive" is a pill twice the width of its
    // neighbour, and with both names shown at once the gloss has nothing left to disambiguate.
    expect(worldShortLabel("HEROIC")).toBe("Heroic");
    expect(worldShortLabel("INTERACTIVE")).toBe("Interactive");
  });

  it("has an other world, and it is an involution", () => {
    expect(otherWorld("HEROIC")).toBe("INTERACTIVE");
    expect(otherWorld("INTERACTIVE")).toBe("HEROIC");
    expect(otherWorld(otherWorld("HEROIC"))).toBe("HEROIC");
  });
});

describe("whether a drop exists here", () => {
  it("puts an unnarrowed drop in both worlds", () => {
    // null is every drop in catalog/drops.yaml today. Reading it as "nowhere" would empty every
    // picker in the app.
    expect(dropExistsIn(null, "INTERACTIVE")).toBe(true);
    expect(dropExistsIn(null, "HEROIC")).toBe(true);
  });

  it("keeps an Interactive-only drop out of Heroic worlds", () => {
    expect(dropExistsIn("INTERACTIVE", "INTERACTIVE")).toBe(true);
    expect(dropExistsIn("INTERACTIVE", "HEROIC")).toBe(false);
  });
});

describe("whether everyone gets their own", () => {
  it("says yes everywhere for ALWAYS", () => {
    expect(isPerMember("ALWAYS", "INTERACTIVE")).toBe(true);
    expect(isPerMember("ALWAYS", "HEROIC")).toBe(true);
  });

  it("turns HEROIC into a yes or a no, never a hedge", () => {
    // The flag the rings carry. One for the party in Interactive worlds, one each in Heroic, and
    // getting it backwards is the pooling-what-cannot-be-pooled mistake in miniature.
    expect(isPerMember("HEROIC", "HEROIC")).toBe(true);
    expect(isPerMember("HEROIC", "INTERACTIVE")).toBe(false);
  });

  it("says no for a drop with no flag", () => {
    expect(isPerMember(null, "INTERACTIVE")).toBe(false);
    expect(isPerMember(null, "HEROIC")).toBe(false);
  });
});

describe("what an account is shown", () => {
  it("draws mesos until the world being shown is one that cannot trade", () => {
    // Undefined is the moment before /api/settings answers, and it draws them: erring towards
    // showing beats blanking every figure on screen for a few milliseconds on every page load.
    expect(showsMoney(undefined)).toBe(true);
    expect(showsMoney(true)).toBe(true);
    expect(showsMoney(false)).toBe(false);
  });
});
