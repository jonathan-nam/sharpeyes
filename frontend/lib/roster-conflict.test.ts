import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { moveLines, rosterConflictOf } from "./roster-conflict";
import type { RosterMove } from "@/types/party";

const conflict = (body: unknown) => new ApiError(409, JSON.stringify(body));

const move: RosterMove = {
  partyId: "4a025d5a-9b2d-4a52-93f0-b87ab9c37a2a",
  member: "CourseLair",
  fromCharacter: "HuskyxKenshi",
  removesParty: true,
};

const oneMove = {
  message: "CourseLair is already in your HuskyxKenshi party for this boss",
  moves: [move],
};

describe("rosterConflictOf", () => {
  it("reads the move a 409 offers", () => {
    const read = rosterConflictOf(conflict(oneMove));
    expect(read?.moves).toHaveLength(1);
    expect(read?.moves[0]?.fromCharacter).toBe("HuskyxKenshi");
    expect(read?.moves[0]?.removesParty).toBe(true);
  });

  it("offers nothing for the refusals that are not a clash", () => {
    expect(rosterConflictOf(new ApiError(400, "a party needs somebody else in it"))).toBeNull();
    expect(rosterConflictOf(new ApiError(404, ""))).toBeNull();
    expect(rosterConflictOf(new Error("network"))).toBeNull();
    expect(rosterConflictOf(null)).toBeNull();
  });

  /*
   * The guard this exists for.
   *
   * The screen turns this body into a button that REMOVES one of the user's parties, so a field
   * that is missing, mistyped, or from a build that spelled it differently has to read as no offer
   * at all. Reading it half way would name the wrong party, or say one survives a move that takes
   * it. See the vision DTO note: a dropped field dies silently and the tests stay green.
   */
  it("refuses a body it cannot read in full, rather than reading part of it", () => {
    expect(rosterConflictOf(new ApiError(409, "not json"))).toBeNull();
    expect(rosterConflictOf(conflict({ message: "x" }))).toBeNull();
    expect(rosterConflictOf(conflict({ message: "x", moves: [] }))).toBeNull();
    expect(rosterConflictOf(conflict({ moves: oneMove.moves }))).toBeNull();
    // One good move and one this build cannot read is still not an offer: confirming would empty
    // the party it could read and silently drop the other.
    expect(
      rosterConflictOf(conflict({ ...oneMove, moves: [...oneMove.moves, { partyId: "b" }] })),
    ).toBeNull();
    // removesParty is the destructive half of the sentence, so a missing one is not assumed either
    // way.
    expect(
      rosterConflictOf(conflict({ ...oneMove, moves: [{ ...move, removesParty: undefined }] })),
    ).toBeNull();
  });
});

describe("moveLines", () => {
  it("says the party goes when nobody is left in it", () => {
    expect(moveLines(oneMove.moves)).toEqual([
      "CourseLair leaves HuskyxKenshi's party, which goes with them.",
    ]);
  });

  it("says only the leaving where the party stands", () => {
    expect(moveLines([{ ...move, removesParty: false }])).toEqual([
      "CourseLair leaves HuskyxKenshi's party.",
    ]);
  });

  it("says one line per party a save takes from", () => {
    expect(
      moveLines([
        { ...move, removesParty: false },
        { partyId: "b", member: "Blaze", fromCharacter: "acornacorn", removesParty: true },
      ]),
    ).toEqual([
      "CourseLair leaves HuskyxKenshi's party.",
      "Blaze leaves acornacorn's party, which goes with them.",
    ]);
  });
});
