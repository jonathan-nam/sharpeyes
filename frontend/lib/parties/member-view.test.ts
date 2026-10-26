import { describe, expect, it } from "vitest";
import { asSeenBy, asYourRow, memberSeats, ownersRoster } from "./member-view";
import { isMine } from "@/lib/wallet";
import type { Party, SeatedParty } from "@/types/party";

// The owner's own row, as the seated list and the party page both send it.
const seats = [
  { id: "s-owner", name: "Thornwick", characterId: "owner-char", linkedCharacterId: null },
  { id: "s-you", name: "Pellmoor", characterId: null, linkedCharacterId: "your-char" },
] as unknown as Party["seats"];

const ownersRow = (fields: Partial<Party> = {}) =>
  ({ id: "p1", characterId: "owner-char", members: seats, seats, ...fields }) as Party;

const seated = (): SeatedParty => ({
  party: ownersRow(),
  mySeatIds: ["s-you"],
  yourCharacterId: "your-char",
});

describe("asYourRow", () => {
  it("files the party under your character", () => {
    expect(asYourRow(seated()).characterId).toBe("your-char");
  });

  it("marks your seat as yours and the owner's as theirs, in the roster and the seats alike", () => {
    const row = asYourRow(seated());
    expect(row.members.map((m) => m.characterId)).toEqual([null, "your-char"]);
    // What the Drop Log and a row's Mark Paid ask. Left on the owner's side, they read the money
    // from the owner's seat.
    expect(row.seats.filter(isMine).map((s) => s.id)).toEqual(["s-you"]);
  });

  it("names the seats you act as, so a pool's controls offer only those", () => {
    expect(asYourRow(seated()).yourSeats).toEqual(["s-you"]);
  });

  it("is not yours to write, whatever the list said", () => {
    // The seated list leaves `yours` at its default of true. Run Order hides the owner's controls on it.
    expect(asYourRow({ ...seated(), party: ownersRow({ yours: true }) }).yours).toBe(false);
  });
});

describe("asSeenBy", () => {
  it("reads the party page's party from your side, by the character your seat links to", () => {
    const seen = asSeenBy(ownersRow({ yours: false, yourSeats: ["s-you"] }));
    expect(seen.characterId).toBe("your-char");
    expect(seen.seats.filter(isMine).map((s) => s.id)).toEqual(["s-you"]);
  });

  it("leaves your own party alone", () => {
    const own = ownersRow({ yours: true });
    expect(asSeenBy(own)).toBe(own);
  });

  it("marks nobody when a cached payload names no seat of yours", () => {
    expect(asSeenBy(ownersRow({ yours: false })).seats.filter(isMine)).toEqual([]);
  });
});

describe("memberSeats", () => {
  it("names the seats a member acts as", () => {
    expect([...(memberSeats(ownersRow({ yours: false, yourSeats: ["s1"] })) ?? [])]).toEqual([
      "s1",
    ]);
  });

  it("is nobody in your own party, which you act in as anybody", () => {
    expect(memberSeats(ownersRow({ yours: true }))).toBeNull();
  });
});

describe("ownersRoster", () => {
  it("puts your seat back and takes the owner's out, which is what the owner's save reads", () => {
    const others = asYourRow(seated())
      .members.filter((m) => m.characterId !== "your-char")
      .map((m) => m.name);
    expect(ownersRoster(seated(), [...others, "Quillon"])).toEqual(["Pellmoor", "Quillon"]);
  });
});
