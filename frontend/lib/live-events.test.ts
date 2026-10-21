import { describe, expect, it } from "vitest";
import { backoffMs, eventsIn } from "./live-events";

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
