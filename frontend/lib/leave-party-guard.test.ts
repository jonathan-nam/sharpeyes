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
const list = source("app", "bosses", "parties", "page.tsx");
const pool = source("components", "loot-pool.tsx");
const row = source("components", "loot-row.tsx");
const confirm = source("components", "confirm-act.tsx");

describe("leaving a party you do not own", () => {
  it("posts to that party's own leave route", () => {
    expect(view).toContain('`/api/parties/${party.id}/leave`, { method: "POST" }');
  });

  it("asks before it writes", () => {
    // It edits somebody else's roster and this account cannot put itself back. The first press only
    // opens the question; the write hangs off the second. ConfirmAct is that, for Disband too.
    expect(confirm).toContain("onClick={() => setAsking(true)}");
    expect(confirm).toContain('<button type="button" className="party-delete" onClick={onConfirm}');
    expect(view).toContain("onConfirm={() => void leave()}");
  });

  it("is offered on a party that is not yours, and its owner disbands instead", () => {
    expect(view).toContain("const readOnly = party?.yours === false;");
    expect(view).toContain('{readOnly ? ( <ConfirmAct label="Leave"');
    expect(view).toContain("onConfirm={() => void disband()}");
  });
});

describe("a pool somebody else keeps", () => {
  it("is handed to the screen as read-only", () => {
    expect(view).toContain("readOnly={readOnly}");
  });

  it("offers the picker to its owner and its members", () => {
    // The one control that creates a row in somebody else's pool. Two accounts logging one night is
    // a double count, which the server's duplicate refusal answers (see duplicateRefusal).
    expect(pool).toContain("{(!readOnly || memberSeats(party)) && ( <DropPicker");
  });

  it("states a share as paid rather than offering to change it", () => {
    expect(row).toContain("{readOnly ? ( <span");
  });

  it("lists a shared party with the clear and Add Drop as its only writes", () => {
    // The card a party somebody else owns is drawn with on Party View. Any seat may tick the
    // party's clear and log a drop into its pool; selling and settling are done on its own page.
    const card = /function sharedCard\([\s\S]*?\); \}/.exec(list)?.[0] ?? "";
    expect(card).toContain("<PartyCard");
    expect(card.match(/ on[A-Z]\w+=/g)).toEqual([" onToggleClear=", " onAddDrop="]);
  });
});
