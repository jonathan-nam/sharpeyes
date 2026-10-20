import { describe, expect, it } from "vitest";
import { asYourRow } from "./shared-parties";
import type { Party, SeatedParty } from "@/types/party";

const seated = (): SeatedParty => ({
  party: {
    id: "p1",
    characterId: "owner-char",
    members: [
      { id: "s-owner", name: "warrior2020", characterId: "owner-char" },
      { id: "s-you", name: "iPhone69C", characterId: null },
    ],
  } as unknown as Party,
  mySeatIds: ["s-you"],
  yourCharacterId: "your-char",
});

describe("asYourRow", () => {
  it("files the party under your character", () => {
    expect(asYourRow(seated()).characterId).toBe("your-char");
  });

  it("marks your seat as yours and the owner's as theirs", () => {
    const members = asYourRow(seated()).members;
    expect(members.map((m) => m.characterId)).toEqual([null, "your-char"]);
  });
});
