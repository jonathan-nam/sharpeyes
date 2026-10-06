import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { holderKey, holderOf } from "./vestige-ledger";
import { draftBoxes, draftDrop, draftStacks } from "./vestige-pickup";
import { shareConfig } from "./vestige-stacks";
import type { BossDrop } from "@/types/drop";
import type { Party, PartyMember } from "@/types/party";

// The night is logged from Run Order, so the coupon night is answered there too.
//
// The page could tick a boss and log its drop, and then had nowhere to say who picked up which
// stack: the split and the pickup were only on Party View, one screen away from the one open while
// the run is happening. A drop logged here landed unanswered, and an unanswered night is a debt
// whose size is known and whose direction is not.
//
// Two halves below. The chain the page builds its boxes from is exercised for real; the wiring that
// hands them to the picker is read out of the source, since there is no component render harness
// here. Same approach as pool-page-stacks.test.ts.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const page = source("app", "bosses", "order", "page.tsx");
const plan = source("components", "run-plan.tsx");

const mine: PartyMember = {
  id: "m1",
  name: "HuskyxKenshi",
  personId: null,
  personName: null,
  characterId: "char-m1",
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
};

const theirs: PartyMember = {
  id: "m2",
  name: "CreedBratton",
  personId: "p-bro",
  personName: "Bro",
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
};

const party: Party = {
  id: "pa",
  slug: "husky/baldrix",
  characterId: "char-m1",
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "baldrix",
  difficulty: "HARD",
  minutes: null,
  looterMemberId: null,
  members: [mine, theirs],
  seats: [mine, theirs],
  usualRoster: true,
  skippedThisPeriod: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

/** Hard Baldrix as the catalog has it: 120 coupons in three stacks of 40. */
const table: BossDrop[] = [
  {
    dropKey: "vestige-of-erion",
    name: "Vestige of Erion Coupon",
    iconUrl: null,
    perMember: null,
    worlds: "INTERACTIVE",
    quantity: 1,
    fungible: true,
    pieces: { INTERACTIVE: { HARD: 120 } },
    bundles: { INTERACTIVE: { HARD: 3 } },
  },
];

/** What the page's stacksFor builds, off the catalog rather than off a logged drop. */
const config = shareConfig(table, party.difficulty, party.worldType, "vestige-of-erion", [
  mine,
  theirs,
]);

describe("a coupon night can be answered from the run it is logged on", () => {
  it("reads the split off the catalog, before anything has fallen", () => {
    // The point of taking it from the table: on this page the drop does not exist yet, so a config
    // read off a logged row would have nothing to read.
    expect(config).toEqual({ quantity: 120, bundles: 3, size: 40, seats: [mine, theirs] });
  });

  it("opens the boxes with the odd stack on whoever is furthest behind", () => {
    // Who is behind is the DRAFT's, not the boxes': a night carries the balance it was drawn
    // against, so the two cannot be paired up wrongly at the call site.
    const behindThem = draftDrop(config!, 120, new Map([[holderKey(holderOf(theirs)), 40]]))!;
    const behindMe = draftDrop(config!, 120, new Map([[holderKey(holderOf(mine)), 40]]))!;

    // Three stacks, 1.5 each: both floor to one and the third rotates rather than always landing
    // on the same person.
    expect(draftBoxes(behindThem, party)).toEqual({ m1: "1", m2: "2" });
    expect(draftBoxes(behindMe, party)).toEqual({ m1: "2", m2: "1" });
  });

  it("sends what was typed, and holds the drop back when it does not add up", () => {
    // Nobody behind: what this asks is whether the typed boxes add up, which the balance the night
    // was drawn against has no part in.
    const night = draftDrop(config!, 120, new Map())!;

    expect(draftStacks(night, { m1: "1", m2: "2" })).toEqual({ m1: 1, m2: 2 });
    // Null takes the Add Drop button with it. The server refuses a part-answered arrangement, and
    // a refusal there would roll the drop back too.
    expect(draftStacks(night, { m1: "1", m2: "1" })).toBeNull();
    // Cleared boxes are how you say nobody has answered yet, which is what a drop logged anywhere
    // else is.
    expect(draftStacks(night, { m1: "", m2: "" })).toEqual({});
  });
});

describe("the run's picker carries both blocks", () => {
  it("hands the draft to the picker on the run's own panel", () => {
    expect(plan).toContain("draft={log.stacksOf?.(party)}");
    expect(page).toContain("stacksOf: haveDropTables ? stacksFor : undefined,");
  });

  it("answers the night with the drop and the split on its own save", () => {
    const built = page.slice(
      page.indexOf("const stacksFor ="),
      page.indexOf("const log: RunLog = {"),
    );
    expect(built.length).toBeGreaterThan(0);
    // The pickup rides along with the POST, so the pair cannot half-land. The split is the party's
    // standing deal and is the only write in the block.
    expect(built).toContain("onSaveShares:");
    expect(built.match(/onSave/g)).toHaveLength(1);
  });

  it("rotates the odd stack against every party, net of what is settled", () => {
    // Party View's reckoning, off the same two lists. Reading the night's own list instead would
    // rotate against half the account, and skipping the settlements would suggest against somebody
    // who has already been compensated for ever.
    expect(page).toContain(
      "runningBalance(stillOpen(outstanding(ledgerParties, pools, VESTIGE, bossOrder), closed))",
    );
    expect(page).toContain("const closed = closedByHolder(settlements).closed;");
  });

  it("re-reads the pools after a drop, so the next run's boxes are not a run behind", () => {
    // A whole night is logged here one run after another. Without this the second run would open on
    // a balance taken before the first run's coupons were picked up.
    expect(page).toContain("await readBack(refetchAfterDrop);");
    expect(page).toContain('apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, getToken),');
  });
});
