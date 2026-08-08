import { describe, expect, it } from "vitest";
import { readShowTimes, SHOW_TIMES_KEY, writeShowTimes } from "@/lib/show-times";

function fakeStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwingStore = {
  getItem() {
    throw new Error("storage is blocked");
  },
  setItem() {
    throw new Error("storage is blocked");
  },
};

describe("show times preference", () => {
  it("runs to the clock for someone who has never answered", () => {
    expect(readShowTimes(fakeStore())).toBe(true);
  });

  it("survives the round trip in both directions", () => {
    const store = fakeStore();
    writeShowTimes(false, store);
    expect(readShowTimes(store)).toBe(false);
    writeShowTimes(true, store);
    expect(readShowTimes(store)).toBe(true);
  });

  // The written value has to be the one the read tests for, or the box comes back ticked.
  it("stores off under its own key", () => {
    const store = fakeStore();
    writeShowTimes(false, store);
    expect(store.data.get(SHOW_TIMES_KEY)).toBe("off");
  });

  // A value from an older build, or another tab writing junk, is not a reason to hide the times.
  it("reads anything it does not recognise as timed", () => {
    expect(readShowTimes(fakeStore({ [SHOW_TIMES_KEY]: "false" }))).toBe(true);
  });

  // Safari in private mode, and any browser with storage switched off, throws on access rather
  // than returning null.
  it("runs to the clock when storage is missing or throws", () => {
    expect(readShowTimes(null)).toBe(true);
    expect(() => writeShowTimes(false, null)).not.toThrow();
    expect(readShowTimes(throwingStore)).toBe(true);
    expect(() => writeShowTimes(false, throwingStore)).not.toThrow();
  });
});
