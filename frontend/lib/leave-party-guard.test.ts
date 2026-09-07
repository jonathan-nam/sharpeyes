import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A shared card is the one place this app writes to a party the account does not own, and leaving
// is the only write it is allowed to make. Everything else on that card is somebody else's book.
//
// There are no component tests in this repo, so this reads the source, the way
// drop-links-guard.test.ts and ledger-css.test.ts do. Whitespace is normalised first, or this fails
// the moment Prettier re-wraps a line.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const page = source("app", "bosses", "parties", "page.tsx");
const card = source("components", "shared-parties.tsx");

describe("leaving a party you do not own", () => {
  it("posts to that party's own leave route", () => {
    expect(page).toContain('`${PARTIES_KEY}/${party.id}/leave`, { method: "POST" }');
  });

  it("is the ONLY write the shared card makes", () => {
    // The card is handed one callback and no others. A second would be a write into somebody else's
    // pool, where two accounts logging one night is a double count with nothing on screen saying so.
    // Deduplicated: the card declares the prop and hands it down to the button, which is twice.
    expect([...new Set(card.match(/on[A-Z]\w+:/g))]).toEqual(["onLeave:"]);
  });

  it("reads the list back rather than dropping the row in place", () => {
    // What the leave left behind is the server's to say: a seat kept for a night already played is
    // still on the roster, and a card removed here would claim otherwise.
    expect(page).toContain("await readBack(refreshSeated)");
    expect(page).toContain("setSeated(refreshed)");
  });

  it("asks before it writes", () => {
    // It edits somebody else's roster and this account cannot put itself back. The first press only
    // opens the question; the write hangs off the second.
    expect(card).toContain("onClick={() => setConfirming(true)}");
    expect(card).toContain('<button type="button" className="party-delete" onClick={onLeave}');
  });
});
