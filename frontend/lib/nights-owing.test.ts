import { describe, expect, it } from "vitest";
import { type HeldOfYours, nightsOwing } from "@/lib/settlement";

const night = (lootId: string, droppedOn: string, pieces: number): HeldOfYours => ({
  lootId,
  partyId: "p",
  bossKey: null,
  weekStart: droppedOn,
  droppedOn,
  pieces,
  sold: 0,
  looterName: "Thornwick",
  ran: ["Thornwick", "Pellmoor"],
  shared: false,
});
const total = (nights: HeldOfYours[]) => nights.reduce((sum, n) => sum + n.pieces, 0);

describe("the nights a coupon net runs on", () => {
  // The shape that asked for it: 380 held one way and 20 the other, off the same day, under 360.
  const theirs = [night("baldrix", "2026-08-13", 20), night("kalos", "2026-10-26", 360)];
  const mine = [night("kaling", "2026-08-13", 20)];

  it("lists the side the net runs, coming to the net", () => {
    const nights = nightsOwing(theirs, mine);
    expect(total(nights)).toBe(360);
    expect(nights.map((n) => n.lootId)).toEqual(["kalos"]);
  });

  it("takes the other side off the oldest nights first", () => {
    const nights = nightsOwing(
      [night("old", "2026-08-01", 30), night("new", "2026-09-01", 30)],
      [night("x", "2026-08-20", 40)],
    );
    expect(nights.map((n) => [n.lootId, n.pieces])).toEqual([["new", 20]]);
  });

  it("runs either way, and draws nothing at an even pair", () => {
    expect(total(nightsOwing(mine, theirs))).toBe(360);
    expect(nightsOwing(mine, [night("y", "2026-08-01", 20)])).toEqual([]);
  });
});
