import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@/types/settings";

// One `/api/settings` read per page load, not one per component that wants it.
//
// The store turned callers away on `current`, which is only set once the read has ANSWERED, so
// every component mounting inside that window opened its own request. Prod logged five reads for a
// single load of /bosses/drops (816ms, then 80, 97, 56, 56), and nine call sites feed the hook.
//
// The module holds `current` and `inFlight` for the life of the page, so each case re-imports it to
// get a fresh one rather than reaching in to reset them.

const SETTINGS: Settings = {
  worldType: "INTERACTIVE",
  trades: true,
  otherWorldCharacters: 0,
  mainCharacterId: null,
  mainCharacterSprite: null,
};

async function freshModule() {
  vi.resetModules();
  return import("./use-account-settings");
}

/** A settings read that counts its callers and resolves when told, so overlap is deliberate. */
function countingFetch(result: () => Promise<Settings>) {
  const state = { calls: 0 };
  return {
    state,
    fetch: () => {
      state.calls += 1;
      return result();
    },
  };
}

describe("loadAccountSettings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sends one request when many callers arrive before it answers", async () => {
    const { loadAccountSettings } = await freshModule();
    let release: (settings: Settings) => void = () => {};
    const pending = new Promise<Settings>((resolve) => {
      release = resolve;
    });
    const { state, fetch } = countingFetch(() => pending);

    // Ten components mounting in the same tick, none of them with an answer yet.
    const waiting = Array.from({ length: 10 }, () => loadAccountSettings(fetch));
    expect(state.calls).toBe(1);

    release(SETTINGS);
    await Promise.all(waiting);
    expect(state.calls).toBe(1);
  });

  it("does not read again once the answer is known", async () => {
    const { loadAccountSettings } = await freshModule();
    const { state, fetch } = countingFetch(() => Promise.resolve(SETTINGS));

    await loadAccountSettings(fetch);
    await loadAccountSettings(fetch);
    await loadAccountSettings(fetch);

    expect(state.calls).toBe(1);
  });

  it("lets the next caller retry after a failed read", async () => {
    const { loadAccountSettings } = await freshModule();
    let attempt = 0;
    const { state, fetch } = countingFetch(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("401")) : Promise.resolve(SETTINGS);
    });

    // A rejection is swallowed, so this resolves either way. What matters is that the guard let go.
    await loadAccountSettings(fetch);
    expect(state.calls).toBe(1);

    await loadAccountSettings(fetch);
    expect(state.calls).toBe(2);

    // And the retry that worked closes it again.
    await loadAccountSettings(fetch);
    expect(state.calls).toBe(2);
  });
});
