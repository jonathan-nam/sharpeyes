import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Leaving is the one write this app makes to a party the account does not own. Everything else on
// that party is somebody else's book, and the screen that draws it must offer none of it.
//
// There are no component tests in this repo, so this reads the source, the way
// drop-links-guard.test.ts and ledger-css.test.ts do. Whitespace is normalised first, or this fails
// the moment Prettier re-wraps a line.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const view = source("app", "bosses", "parties", "[...slug]", "page.tsx");
const card = source("components", "shared-parties.tsx");
const pool = source("components", "loot-pool.tsx");
const row = source("components", "loot-row.tsx");

describe("leaving a party you do not own", () => {
  it("posts to that party's own leave route", () => {
    expect(view).toContain('`/api/parties/${party.id}/leave`, { method: "POST" }');
  });

  it("asks before it writes", () => {
    // It edits somebody else's roster and this account cannot put itself back. The first press only
    // opens the question; the write hangs off the second.
    expect(view).toContain("onClick={() => setLeaving(true)}");
    expect(view).toContain('<button type="button" className="party-delete" onClick={leave}');
  });

  it("is offered only on a party that is not yours", () => {
    expect(view).toContain("const readOnly = party?.yours === false;");
    expect(view).toContain("{readOnly && (");
  });
});

describe("a pool somebody else keeps", () => {
  it("is handed to the screen as read-only", () => {
    expect(view).toContain("readOnly={readOnly}");
  });

  it("offers nothing that would add to it", () => {
    // The picker is the one control that creates a row in somebody else's pool, where two accounts
    // logging one night is a double count with nothing on screen saying so.
    expect(pool).toContain("{!readOnly && ( <DropPicker");
  });

  it("states a share as paid rather than offering to change it", () => {
    expect(row).toContain("{readOnly ? ( <span");
  });

  it("leaves the shared card with no writes at all", () => {
    // Every callback it used to take has gone to the party's own page.
    expect(card.match(/on[A-Z]\w+:/g)).toBeNull();
  });
});
