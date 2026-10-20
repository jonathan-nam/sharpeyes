import { describe, expect, it } from "vitest";
import { inviteUrl, joinCallbackPath, timeLeft } from "./invite-link";

describe("inviteUrl", () => {
  it("points at the join page on the origin the link was made from", () => {
    expect(inviteUrl("https://sharpeyes.app", "abc123")).toBe("https://sharpeyes.app/join/abc123");
  });

  it("escapes a token, because it is base64url and a browser is not asked to guess", () => {
    expect(inviteUrl("https://sharpeyes.app", "a+b/c")).toBe(
      "https://sharpeyes.app/join/a%2Bb%2Fc",
    );
  });

  it("sends the sign-in round trip back to the same link", () => {
    // Discord returns to whatever this names, so a mismatch with inviteUrl's path is an invite
    // that survives being opened and dies on being signed into.
    expect(joinCallbackPath("abc123")).toBe("/join/abc123");
    expect(inviteUrl("https://sharpeyes.app", "abc123")).toBe(
      `https://sharpeyes.app${joinCallbackPath("abc123")}`,
    );
  });
});

describe("timeLeft", () => {
  const at = (iso: string) => timeLeft("2026-09-03T00:05:00Z", new Date(iso));

  it("counts down in minutes and seconds", () => {
    expect(at("2026-09-03T00:00:00Z")).toBe("5:00");
    expect(at("2026-09-03T00:00:28Z")).toBe("4:32");
    expect(at("2026-09-03T00:04:51Z")).toBe("0:09");
  });

  // Floored: 0:01 with most of a second behind it is a second you do not have.
  it("floors the part second", () => {
    expect(at("2026-09-03T00:04:58.900Z")).toBe("0:01");
  });

  // Null, not "0:00". A dead link is a different thing to say, and it is the one that stops
  // offering a Copy button for an address that no longer works.
  it("is nothing at all once the link is spent", () => {
    expect(at("2026-09-03T00:05:00Z")).toBeNull();
    expect(at("2026-09-03T00:06:00Z")).toBeNull();
  });
});
