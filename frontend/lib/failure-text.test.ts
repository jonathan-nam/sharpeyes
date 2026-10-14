import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError, SAVED_BUT_STALE, StaleAfterWrite, failureText } from "./api";

describe("failureText", () => {
  it("shows a refusal the backend marked for users", () => {
    const e = new ApiError(
      400,
      JSON.stringify({ refusal: "Two people share a name. Rename one." }),
    );
    expect(failureText(e, "Couldn't save that.")).toBe("Two people share a name. Rename one.");
  });

  it("never shows a raw body", () => {
    for (const body of [
      "malformed characterId",
      "personId is not somebody on your people list",
      '{"status":"db unreachable"}',
      "<html><body>502 Bad Gateway</body></html>",
      "",
    ]) {
      expect(failureText(new ApiError(400, body), "That didn't save.")).toBe("That didn't save.");
    }
  });

  it("says a write that landed is saved", () => {
    expect(failureText(new StaleAfterWrite(new Error("401")), "That didn't save.")).toBe(
      SAVED_BUT_STALE,
    );
  });

  it("falls back for anything else", () => {
    expect(failureText(new TypeError("Failed to fetch"), "That didn't save.")).toBe(
      "That didn't save.",
    );
  });
});

// The leak this closes was per call site: thirty of them rendered `e.body` or `e.message` directly.
describe("no screen renders an error's own text", () => {
  const root = join(__dirname, "..");
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx$/.test(name) && !name.includes(".test.") ? [path] : [];
    });

  it.each([...sources(join(root, "app")), ...sources(join(root, "components"))])("%s", (path) => {
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/\be\.body\b|\b(e|err|error)\.message\b/);
  });
});
