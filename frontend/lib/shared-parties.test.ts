import { describe, expect, it } from "vitest";
import { asYourRow, ownersRoster } from "./shared-parties";
import type { Party, SeatedParty } from "@/types/party";

const seated = (): SeatedParty => ({
  party: {
    id: "p1",
    characterId: "owner-char",
    members: [
      { id: "s-owner", name: "orchid88", characterId: "owner-char" },
      { id: "s-you", name: "Moxie77Q", characterId: null },
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

  it("is not yours to write, whatever the list said", () => {
    // The seated list leaves `yours` at its default of true. Run Order hides the owner's controls on it.
    expect(asYourRow({ ...seated(), party: { ...seated().party, yours: true } }).yours).toBe(false);
  });
});

describe("ownersRoster", () => {
  it("puts your seat back and takes the owner's out, which is what the owner's save reads", () => {
    const others = asYourRow(seated())
      .members.filter((m) => m.characterId !== "your-char")
      .map((m) => m.name);
    expect(ownersRoster(seated(), [...others, "Quillon"])).toEqual(["Moxie77Q", "Quillon"]);
  });
});
