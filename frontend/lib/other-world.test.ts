import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The world toggle narrows every account-wide list server-side, so an empty page can mean "you are
// standing in the other world" rather than "you have nothing". Only /characters ever said so, and
// three of these pages went further and told you to add characters you already had.
//
// A source-reading guard rather than a unit test, for the reason drop-log-callers.test.ts is one:
// the failure is a page NOT rendering something, which type-checks perfectly and shows up only as a
// screen that misleads.

const root = join(__dirname, "..");

/**
 * The pages whose emptiness the toggle can cause, and the empty state each one draws.
 *
 * Not every page: the Drop Log's own tabs collapse to one in Heroic (see dropSections) and the
 * Drop Splitter leaves the menu entirely, so neither can sit there looking empty for a reason it
 * will not name.
 */
const NARROWED = [
  ["app/characters/page.tsx", "the roster itself"],
  ["app/inventory/page.tsx", "an inventory with no character to show"],
  ["app/bosses/page.tsx", "the clears matrix"],
  ["app/bosses/routine/page.tsx", "which bosses each character runs"],
  ["app/bosses/parties/page.tsx", "Party View"],
  ["app/bosses/parties/edit/page.tsx", "the party editor"],
] as const;

describe("a page narrowed by the world toggle says where the rest of the account is", () => {
  it.each(NARROWED)("%s draws it, for %s", (path) => {
    expect(readFileSync(join(root, path), "utf8")).toContain("<OtherWorld />");
  });

  it("says it in one place, so the six cannot word it six ways", () => {
    const component = readFileSync(join(root, "components/other-world.tsx"), "utf8");
    expect(component).toContain("otherWorldCharacters");
    // The count is the whole point. A hint that says "check the other world" without saying whether
    // anything is over there is a page guessing, and it would show on every single-world account.
    expect(component).toContain("settings.otherWorldCharacters === 0");
  });

  it("no longer sends anybody to the Inventory page to add a character", () => {
    // The add control moved to /characters, and /inventory's own empty state has said so for a
    // while. Three pages kept pointing at the old place, and said it to accounts whose characters
    // were merely in the other world.
    for (const [path] of NARROWED) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source, `${path} still points at the Inventory page`).not.toContain(
        "character on the Inventory page",
      );
    }
  });
});
