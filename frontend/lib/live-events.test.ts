import { describe, expect, it } from "vitest";
import { backoffMs, topicsIn } from "./live-events";

describe("reading the live event stream", () => {
  it("takes the topic of each complete event and keeps the one still arriving", () => {
    const { topics, rest } = topicsIn(
      ": open\n\nevent: clears\ndata: {}\n\n: ping\n\nevent: notifications\ndata: {}\n\nevent: cle",
    );
    expect(topics).toEqual(["clears", "notifications"]);
    expect(rest).toBe("event: cle");
  });

  it("finishes an event split across two reads", () => {
    const first = topicsIn("event: cle");
    expect(first.topics).toEqual([]);
    expect(topicsIn(`${first.rest}ars\ndata: {}\n\n`).topics).toEqual(["clears"]);
  });

  it("drops a topic this build does not know", () => {
    expect(topicsIn("event: sales\ndata: {}\n\n").topics).toEqual([]);
  });

  it("backs off to a ceiling", () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
