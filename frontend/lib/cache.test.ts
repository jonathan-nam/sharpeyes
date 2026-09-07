import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate, peek, put, storedAt } from "./cache";
import { msUntil, serverNowMs } from "./reset-countdown";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const KEY = "/api/bosses/clears";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  invalidate("/api/");
});

describe("cache", () => {
  it("hands back what was put, and drops it on a matching invalidate", () => {
    put(KEY, { now: "2026-09-07T12:00:00Z" });
    expect(peek<{ now: string }>(KEY)?.now).toBe("2026-09-07T12:00:00Z");

    invalidate("/api/characters");
    expect(peek(KEY)).toBeDefined();

    invalidate("/api/bosses");
    expect(peek(KEY)).toBeUndefined();
    expect(storedAt(KEY)).toBeUndefined();
  });

  it("records when an entry was put", () => {
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    put(KEY, { now: "2026-09-07T12:00:00Z" });
    expect(storedAt(KEY)).toBe(Date.parse("2026-09-07T12:00:00Z"));

    vi.setSystemTime(new Date("2026-09-07T12:05:00Z"));
    put(KEY, { now: "2026-09-07T12:05:00Z" });
    expect(storedAt(KEY)).toBe(Date.parse("2026-09-07T12:05:00Z"));
  });

  /*
   * The bug this pairing exists for: switching between Individual and Party View mounted a page
   * seeded from this cache, and it read the entry's AGE as clock skew. Both reset countdowns drew
   * five minutes ahead until the refresh landed, then snapped back.
   */
  it("pairs a cached server clock with when it landed, so the countdown does not drift", () => {
    const reset = "2026-09-10T00:00:00Z";

    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    put(KEY, { now: "2026-09-07T12:00:00Z" });

    // Five minutes later, the other view mounts and seeds from the cache without fetching yet.
    vi.setSystemTime(new Date("2026-09-07T12:05:00Z"));
    const seeded = peek<{ now: string }>(KEY);
    if (!seeded) throw new Error("seeded from an empty cache");
    const nowOnServer = serverNowMs(seeded.now, storedAt(KEY) ?? Date.now(), Date.now());

    expect(nowOnServer).toBe(Date.parse("2026-09-07T12:05:00Z"));
    expect(msUntil(reset, nowOnServer)).toBe(2 * 24 * 60 * MINUTE + 11 * 60 * MINUTE + 55 * MINUTE);
  });

  it("still corrects a browser clock that disagrees with the server's", () => {
    // Cached when the browser said 12:00:00 and the server said 12:00:30: half a minute fast.
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    put(KEY, { now: "2026-09-07T12:00:30Z" });

    vi.setSystemTime(new Date("2026-09-07T12:01:00Z"));
    const seeded = peek<{ now: string }>(KEY);
    if (!seeded) throw new Error("seeded from an empty cache");

    expect(serverNowMs(seeded.now, storedAt(KEY) ?? Date.now(), Date.now())).toBe(
      Date.parse("2026-09-07T12:01:30Z"),
    );
  });
});
