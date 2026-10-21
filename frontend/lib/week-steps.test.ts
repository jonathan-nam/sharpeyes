import { describe, expect, it } from "vitest";
import { stepThrough } from "./week-steps";

describe("stepThrough", () => {
  const weeks = ["2026-10-15", "2026-10-08", "2026-10-01"];

  it("steps back from every week to the newest, and no further forward", () => {
    expect(stepThrough(weeks, "")).toEqual({ previous: "2026-10-15", next: null });
  });

  it("steps forward from the newest week back to every week", () => {
    expect(stepThrough(weeks, "2026-10-15")).toEqual({ previous: "2026-10-08", next: "" });
  });

  it("steps between weeks in the middle", () => {
    expect(stepThrough(weeks, "2026-10-08")).toEqual({
      previous: "2026-10-01",
      next: "2026-10-15",
    });
  });

  it("goes no further back than the oldest week", () => {
    expect(stepThrough(weeks, "2026-10-01")).toEqual({ previous: null, next: "2026-10-08" });
  });

  it("has nowhere to go from a week the list does not hold", () => {
    expect(stepThrough(weeks, "2026-09-24")).toEqual({ previous: null, next: null });
  });
});
