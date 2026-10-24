import { describe, expect, it } from "vitest";
import { differences, goldenJson } from "@/lib/golden-json";

describe("differences", () => {
  it("finds nothing between equal figures, absent and null alike", () => {
    expect(differences({ a: 1, b: null }, { a: 1.0 })).toEqual([]);
  });

  it("names each differing path, leaving the map tags out so the server keeps it", () => {
    const expected = goldenJson({ owed: new Map([["person:1", { mesos: 10 }]]), n: [1, 2] });
    const actual = goldenJson({ owed: new Map([["person:1", { mesos: 11 }]]), n: [1, 3] });
    expect(differences(expected, actual)).toEqual(["owed.0.1.mesos", "n.1"]);
  });

  it("counts a reordered map as different", () => {
    const one = goldenJson(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const two = goldenJson(
      new Map([
        ["b", 2],
        ["a", 1],
      ]),
    );
    expect(differences(one, two)).not.toEqual([]);
  });
});
