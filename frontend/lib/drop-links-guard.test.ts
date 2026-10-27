import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Naming a drop and opening its PARTY answers a different question from the one that was asked. The
// party is every drop that boss ever gave you; the row that was clicked is one of them.
//
// Three lists name a single drop: the Drop Ledger, the Settled tab, and the offsets on a Settlement
// Ledger card. All of them have to open that drop's own history. There are no component tests in
// this repo, so this reads the source, the same way ledger-css.test.ts and piece-row-guard.test.ts
// do.
//
// Whitespace is normalised first, or this fails the moment Prettier re-wraps a line.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const droplog = source("app", "bosses", "drops", "(log)", "layout.tsx");
const settled = source("components", "settled-view.tsx");
// The card is settlement-ledger.tsx drawn through ledger-card.tsx, so a guard reads both.
const ledger =
  source("components", "settlement-ledger.tsx") + source("components", "ledger-card.tsx");

describe("a row that names one drop opens that drop", () => {
  it("opens the drop from a Drop Ledger row and from each run behind a fold", () => {
    // Twice: the row that stands for one drop, and each run behind a fold. A fold's own name links
    // nowhere, because it stands for several.
    expect(droplog.match(/\/bosses\/drops\/\$\{entry\.lootId\}/g)).toHaveLength(2);
    // The field the party link was built from is gone, so there is nothing to fall back to.
    expect(droplog).not.toContain("partySlug");
  });

  it("opens the drop from a Settled row and from a night inside a fold", () => {
    expect(settled).toContain("href={`/bosses/drops/${row.lootId}`}");
    // Twice: the line that stands for one drop, and each night behind a settlement's fold.
    expect(settled.match(/\/bosses\/drops\/\$\{row\.lootId\}/g)).toHaveLength(2);
    expect(settled).not.toContain("/bosses/parties/${row.partyId}");
  });

  it("opens the drop from an offset, and from each share behind a folded one", () => {
    expect(ledger).toContain("href={`/bosses/drops/${one.lootId}`}");
    expect(ledger).toContain("href={`/bosses/drops/${share.lootId}`}");
  });

  it("still opens the PARTY from the rows that are about a party", () => {
    // The queue of nights waiting to be answered, and the drops on a card, are lists of nights on
    // one boss. Those are the party's, and this guard is not an instruction to change them.
    //
    // Through the helper, because the address is the config's readable name and not its id. What is
    // pinned here is which row opens a party, not how the path is spelled. See lib/party-path.ts.
    expect(ledger).toContain("href: partyHrefById(line.partyId, partyById),");
    expect(ledger).toContain("href={partyHrefById(drop.partyId, partyById)}");
  });

  it("keeps the way back to the party on the drop's own page", () => {
    // Only where there is somewhere to go: a retired config is on no list. See DropAudit.
    const audit = source("components", "drop-audit.tsx");
    expect(audit).toContain("href={`/bosses/parties/${audit.partySlug}`}");
    expect(audit).toContain("audit.partyRetired ?");
  });
});
