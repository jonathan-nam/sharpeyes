import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, COALESCE_MS, coalesce, eventsIn } from "./live-events";

describe("reading the live event stream", () => {
  it("takes the topic of each complete event and keeps the one still arriving", () => {
    const { events, rest } = eventsIn(
      ": open\n\nevent: clears\ndata: {}\n\n: ping\n\nevent: notifications\ndata: {}\n\nevent: cle",
    );
    expect(events.map((e) => e.topic)).toEqual(["clears", "notifications"]);
    expect(rest).toBe("event: cle");
  });

  it("finishes an event split across two reads", () => {
    const first = eventsIn("event: cle");
    expect(first.events.map((e) => e.topic)).toEqual([]);
    expect(eventsIn(`${first.rest}ars\ndata: {}\n\n`).events.map((e) => e.topic)).toEqual([
      "clears",
    ]);
  });

  it("carries who made the change and what it touched", () => {
    const data = '{"actor":"u","image":"https://cdn/a.png","target":{"party":"p","loot":"l"}}';
    expect(eventsIn(`event: loot\ndata: ${data}\n\n`).events).toEqual([
      { topic: "loot", actor: "u", image: "https://cdn/a.png", target: { party: "p", loot: "l" } },
    ]);
  });

  it("drops a topic this build does not know", () => {
    expect(eventsIn("event: sales\ndata: {}\n\n").events.map((e) => e.topic)).toEqual([]);
  });

  it("backs off to a ceiling", () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe("coalescing a burst of events", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once for the topics one write sends", async () => {
    const run = vi.fn();
    const burst = coalesce(run);
    burst.trigger();
    burst.trigger();
    burst.trigger();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs once more after a pending run, never alongside it", async () => {
    let finish = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const burst = coalesce(run);
    burst.trigger();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    burst.trigger();
    burst.trigger();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps running after a run fails", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const burst = coalesce(run);
    burst.trigger();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    burst.trigger();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs nothing once cancelled", async () => {
    const run = vi.fn();
    const burst = coalesce(run);
    burst.trigger();
    burst.cancel();
    burst.trigger();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(run).not.toHaveBeenCalled();
  });
});
