import { describe, expect, it } from "vitest";
import { asSeenBy, memberSeats } from "@/lib/parties";
import type { Party } from "@/types/party";

const party = (fields: Partial<Party>) => fields as Party;

describe("memberSeats", () => {
  it("names the seats a member acts as", () => {
    expect([...(memberSeats(party({ yours: false, yourSeats: ["s1"] })) ?? [])]).toEqual(["s1"]);
  });

  it("is nobody in your own party, which you act in as anybody", () => {
    expect(memberSeats(party({ yours: true }))).toBeNull();
  });
});

describe("asSeenBy", () => {
  const members = [
    { id: "s-owner", characterId: "owner-char" },
    { id: "s-you", characterId: null },
  ] as unknown as Party["members"];

  it("marks your seat, not the owner's, in a party you do not own", () => {
    const seen = asSeenBy(party({ yours: false, yourSeats: ["s-you"], members }));
    expect(seen.map((m) => m.characterId)).toEqual([null, "s-you"]);
  });

  it("leaves your own party's roster alone", () => {
    expect(asSeenBy(party({ yours: true, members }))).toBe(members);
  });
});
