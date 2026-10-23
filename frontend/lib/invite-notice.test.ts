import { describe, expect, it } from "vitest";
import { alreadyPartiedText } from "./invite-notice";

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
