import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignableDrops, pieceTallies } from "./vestige-pickup";
import { holderKey, holderOf } from "./vestige-ledger";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

// The Loot pool page states what each seat was entitled to and what they picked up.
//
// Hard Baldrix, two seats: Bro's character took two of the three stacks one week and none the next,
// and the party header said "20 coupons owed" over a list of nights that all looked alike. The gap
// IS the debt, and neither half of it can be worked out from the other, so the page that states the
// figure has to be able to show the nights behind it.
//
// Stated at rest and corrected behind the pool's own Edit, except on a night whose books are
// closed. Source tests for the wiring, since there is no component render harness: the same
// approach as stack-blocks-in-row.test.ts.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const page = source("app", "bosses", "parties", "[...slug]", "page.tsx");
const pool = source("components", "loot-pool.tsx");
const list = source("components", "loot-list.tsx");

const mine = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: `char-${id}`,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const theirs = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: "p-bro",
  personName: "Bro",
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const husky = mine("m1", "HuskyxKenshi");
const creed = theirs("m2", "CreedBratton");

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
  members: [husky, creed],
  seats: [husky, creed],
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

/** One night off Hard Baldrix: 120 coupons in three stacks of 40. */
const night = (id: string, droppedOn: string, by: Record<string, number>): Loot => ({
  id,
  dropKey: "vestige-of-erion",
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "baldrix",
  quantity: 120,
  difficulty: null,
  droppedOn,
  weekStart: droppedOn,
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: ["m1", "m2"],
  bundles: 3,
  bundlesBy: Object.entries(by).map(([memberId, bundles]) => ({ memberId, bundles })),
});

/** The coupon, as the boxes ask for a drop. */
const COUPON = { dropKey: "vestige-of-erion", behind: new Map<string, number>() };

describe("the pool page can show the nights behind a coupon debt", () => {
  it("states both halves of the night that made the debt", () => {
    // The one that produced "20 coupons owed": two stacks to Bro, one to you, 1.5 each was the deal.
    const drops = assignableDrops(party, [night("l1", "2026-08-13", { m1: 1, m2: 2 })], COUPON);
    const tallies = pieceTallies(drops[0]!, drops[0]!.counts);

    expect(tallies.get(holderKey(holderOf(husky)))).toEqual({ took: 40, due: 60 });
    expect(tallies.get(holderKey(holderOf(creed)))).toEqual({ took: 80, due: 60 });
  });

  it("states the night that runs the other way too", () => {
    // The same page has to show the week you looted the lot, or it only ever explains one direction.
    const drops = assignableDrops(party, [night("l2", "2026-08-23", { m1: 3 })], COUPON);
    const tallies = pieceTallies(drops[0]!, drops[0]!.counts);

    expect(tallies.get(holderKey(holderOf(husky)))).toEqual({ took: 120, due: 60 });
    expect(tallies.get(holderKey(holderOf(creed)))).toEqual({ took: 0, due: 60 });
  });

  it("says nothing about who took what on a night nobody answered for", () => {
    // `due` stands either way; `took` is exactly what an unanswered night cannot say. Drawing the
    // suggestion at rest would put a pickup nobody entered on screen as though it had happened.
    const drops = assignableDrops(party, [night("l3", "2026-08-23", {})], COUPON);

    expect(drops[0]!.recorded).toBe(false);
    expect(drops[0]!.counts).toEqual({});
  });

  it("covers the whole pool, not one week", () => {
    // Party View's row is about the week on screen. This page is where a debt older than tonight is
    // gone through, so narrowing here would hide the very night being asked about.
    expect(page).toContain("assignableDrops(party, loot, {");
    expect(page).not.toContain("dropsInWeek");
  });

  it("lets the night be corrected and leaves the standing split alone", () => {
    expect(page).toContain("stacks={stacks}");
    expect(pool).toContain("stacks={stacks}");

    const built = page.slice(
      page.indexOf("const stacks = (() =>"),
      page.indexOf("const summary = summarize(loot);"),
    );
    expect(built.length).toBeGreaterThan(0);
    // Who bent down is a fact about this pool's night, so it is answered here.
    expect(built).toContain("onSave: setBundles");
    // The ratio is the PARTY's and belongs to its editor. Exactly one onSave in the block, so the
    // split cannot pick one up without this failing.
    expect(built.match(/onSave/g)).toHaveLength(1);
    expect(page).toContain("/bundles");
  });

  it("refuses to reopen a night whose books are closed", () => {
    // A settled drop has been paid against. Rewriting who picked up which stack would move a figure
    // somebody has already been shown, which is the silent wrong number this repo exists to stop.
    expect(page).toContain("locked: new Set(mine.filter((entry) => entry.closed)");
    expect(list).toContain("!pickup.locked?.has(item.id)");
    // And the way in is not offered at all when every night is settled.
    expect(pool).toContain("pickup.drops.some((drop) => !pickup.locked?.has(drop.lootId))");
  });

  it("opens the boxes behind an Edit rather than leaving them out", () => {
    // An unanswered night's boxes open on a GUESS (a named looter, or the balanced split). Drawn at
    // rest that reads as a pickup somebody entered. See StackPickup.
    expect(pool).toContain("const [editing, setEditing] = useState(false)");
    expect(pool).toContain('{editing ? "Cancel" : "Edit"}');
  });

  it("draws a summary rather than boxes when nothing can be saved", () => {
    expect(source("components", "stack-pickup.tsx")).toContain(
      "if (!editing || !onSave) return <PickupSummary drop={drop} />;",
    );
    expect(source("components", "stack-assign.tsx")).toContain(
      "if (!editing || !onSave) return <ShareSummary config={config} />;",
    );
  });
});
