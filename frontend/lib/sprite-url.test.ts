import { describe, expect, it } from "vitest";
import { spriteUrl } from "./api";
import { seatSpriteUrls } from "./seat-sprites";
import type { Party, PartyMember } from "@/types/party";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

describe("spriteUrl", () => {
  it("resolves a backend-relative proxy path against the API", () => {
    const path = "/character-sprites/abc123.png";
    expect(spriteUrl(path)).toBe(`${API_BASE}${path}`);
  });

  it("adds no version stamp", () => {
    // The path is a hash of the source URL, which encodes the outfit, so the bytes behind it cannot
    // change. A stamp would throw the year-long immutable cache away on every deploy for nothing.
    expect(spriteUrl("/character-sprites/abc123.png")).not.toContain("?v=");
  });
});

const member = (name: string, spriteImgUrl: string | null): PartyMember => ({
  id: name,
  name,
  personId: null,
  personName: null,
  characterId: null,
  spriteImgUrl,
  guest: false,
  shares: 1,
});

const party = (members: PartyMember[]) => ({ members }) as Party;

describe("seatSpriteUrls", () => {
  it("warms resolved URLs, not the bare backend paths", () => {
    // A bare path assigned to an <img> resolves against the FRONTEND's origin, so the warm would
    // 404 and every seat would still pay for its sprite on the click it was meant to front-run.
    const urls = seatSpriteUrls([party([member("a", "/character-sprites/aaa.png")])]);
    expect(urls).toEqual([`${API_BASE}/character-sprites/aaa.png`]);
  });

  it("names one URL for a character sitting in two parties", () => {
    const urls = seatSpriteUrls([
      party([member("a", "/character-sprites/aaa.png")]),
      party([member("a", "/character-sprites/aaa.png"), member("b", "/character-sprites/bbb.png")]),
    ]);
    expect(urls).toHaveLength(2);
  });

  it("skips a seat with no sprite rather than warming a null", () => {
    expect(seatSpriteUrls([party([member("a", null)])])).toEqual([]);
  });
});
