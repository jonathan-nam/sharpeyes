import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A picker answering for one party offers that party's pile of Eternal pieces too. The prop is
// optional, so a caller that forgets it type-checks and quietly lists no pieces: Run Order did.
// A picker with a party in hand is one passed `draft`, which only those callers can build. The Drop
// Log's form is not one: its draft is a Vestige's split only, and its other drops stay solo.

const root = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

describe("every party's drop picker offers its Eternal pieces", () => {
  const pickers = ["app", "components"].flatMap((dir) =>
    sources(join(root, dir)).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/<DropPicker\b[\s\S]*?\/>/g)].map((m) => ({ file, tag: m[0] }));
    }),
  );
  const withParty = pickers.filter(
    (p) => /\bdraft=/.test(p.tag) && !p.file.endsWith("log-drop.tsx"),
  );

  it("finds the callers it guards", () => {
    expect(withParty.length).toBeGreaterThanOrEqual(2);
  });

  it.each(withParty.map((p) => [p.file.slice(root.length + 1), p.tag]))(
    "%s passes piece",
    (_, tag) => {
      expect(tag).toMatch(/\bpiece=/);
    },
  );
});
