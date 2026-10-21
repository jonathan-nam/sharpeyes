import { describe, expect, it } from "vitest";
import { noPending, pendingFor, shownCount, withPending, withoutPending } from "./pending-counts";

const ME = "char-tidelark";
const THEM = "char-orchid88";

describe("a figure being edited", () => {
  it("is shown over the stored one", () => {
    const held = withPending(noPending(ME), ME, "kalos", 28);
    expect(shownCount(27, pendingFor(held, ME)["kalos"])).toBe(28);
  });

  it("SURVIVES the refresh it triggered", () => {
    // The flicker this file exists for. The write succeeds, the page asks for the inventory again,
    // and until that answer lands the stored figure is still the OLD one. Dropping the local
    // figure at the moment of success meant the slot showed new, then old, then new again.
    //
    // There is no refresh counter in the key. That is the fix, stated as a test: nothing about
    // re-reading the inventory can clear what is being edited.
    const held = withPending(noPending(ME), ME, "kalos", 28);

    // The same state, read again after a refresh: still 28, whatever the stored figure says.
    expect(shownCount(27, pendingFor(held, ME)["kalos"])).toBe(28);
    // And once the server catches up, both answers agree, so nothing changes on screen.
    expect(shownCount(28, pendingFor(held, ME)["kalos"])).toBe(28);
  });

  it("is not shown under another character's name", () => {
    const held = withPending(noPending(ME), ME, "kalos", 28);
    expect(pendingFor(held, THEM)).toEqual({});
    expect(shownCount(14, pendingFor(held, THEM)["kalos"])).toBe(14);
  });

  it("is dropped wholesale when a different character is edited", () => {
    // Not merged. What was pending for one inventory has nothing to say about another's.
    const mine = withPending(noPending(ME), ME, "kalos", 28);
    const theirs = withPending(mine, THEM, "limbo", 4);

    expect(pendingFor(theirs, THEM)).toEqual({ limbo: 4 });
    expect(pendingFor(theirs, ME)).toEqual({});
  });

  it("keeps the others when one write is refused", () => {
    const held = withPending(withPending(noPending(ME), ME, "kalos", 28), ME, "limbo", 4);
    const after = withoutPending(held, "kalos");

    expect(pendingFor(after, ME)).toEqual({ limbo: 4 });
  });

  it("falls back to the stored figure once one is forgotten", () => {
    const held = withPending(noPending(ME), ME, "kalos", 28);
    const after = withoutPending(held, "kalos");

    expect(shownCount(27, pendingFor(after, ME)["kalos"])).toBe(27);
  });
});

describe("zero", () => {
  it("is a figure like any other", () => {
    // An item stepped down to none. Testing truthiness here would show the count it had before,
    // which is the item still looking held after you spent it.
    const held = withPending(noPending(ME), ME, "kalos", 0);
    expect(shownCount(27, pendingFor(held, ME)["kalos"])).toBe(0);
  });

  it("is still distinguishable from nothing pending", () => {
    expect(shownCount(27, undefined)).toBe(27);
    expect(shownCount(27, 0)).toBe(0);
  });
});
