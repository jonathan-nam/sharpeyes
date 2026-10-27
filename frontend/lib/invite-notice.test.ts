import { describe, expect, it } from "vitest";
import { alreadyPartiedText, rosterNotices } from "./invite-notice";
import type { Party } from "@/types/party";

describe("what a save says about friends' characters", () => {
  it("shows the server's sentences, and only those it wrote", () => {
    const saved = {
      outcome: [
        {
          name: "Pinewick",
          result: "ASKED",
          text: "Asked Pinewick's player to move Pinewick here.",
        },
        { name: "Baldrix", result: "SEATED", text: null },
      ],
    } as unknown as Party;
    expect(rosterNotices(saved)).toEqual(["Asked Pinewick's player to move Pinewick here."]);
  });

  it("falls back to the names a server from before outcomes sends", () => {
    const saved = { alreadyPartied: ["Pinewick"] } as unknown as Party;
    expect(rosterNotices(saved)).toEqual([alreadyPartiedText(["Pinewick"])]);
  });
});

describe("the not-invited dialog", () => {
  it("names who was not invited, then what to do", () => {
    expect(alreadyPartiedText(["Pinewick"])).toBe(
      "Pinewick is already in a party for this boss. Ask them to leave it first.",
    );
    expect(alreadyPartiedText(["Pinewick", "Baldrix", "Owen"])).toBe(
      "Pinewick, Baldrix and Owen are already in a party for this boss. Ask them to leave it first.",
    );
  });
});
