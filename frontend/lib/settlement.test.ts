import { describe, expect, it } from "vitest";
import {
  buildSettlement,
  decidedSales,
  settlementTotals,
  isEmpty,
  keptOfYours,
  moneyRows,
  offsetOf,
  owedByYouShares,
  splittableDebts,
  settleThePair,
  undecidedSales,
  sharesOf,
  yourPiles,
  shareKey,
} from "./settlement";
import type { OffsetShare } from "./settlement";
import {
  answeredKey,
  paymentsSinceClosing,
  receivedSinceClosing,
  saleCredits,
} from "./vestige-ledger";
import type { AnsweredSale } from "./piece-ledger";
import type { CouponSale, Holder, HolderLedger } from "./vestige-ledger";
import type { Counterparty, Wallet, WalletLine } from "./wallet";
import type { ProceedsDisposal, SettlementDebt } from "@/types/vestige";

const M = 1_000_000;

// The nights one handover closes, both piles. Counted here rather than returned by settleThePair:
// the card lists them and no longer says how many, so a count on the type had no reader.
const closes = (pair: ReturnType<typeof settleThePair>) => pair.theirs.length + pair.yours.length;

const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };
const JARED: Holder = { kind: "PERSON", personId: "p-jared", characterName: null };
const STRANGER: Holder = { kind: "CHARACTER", personId: null, characterName: "zaddy" };

/** One holder's card, with only the fields the settlement reads. */
const ledger = (holder: Holder, name: string, over: Partial<HolderLedger> = {}): HolderLedger => ({
  holder,
  holderName: name,
  pieces: 0,
  owedToYou: 0,
  received: 0,
  kept: 0,
  ownShare: 0,
  bought: { pieces: 0, paid: 0 },
  soldPieces: 0,
  answered: 0,
  answeredByCreditor: new Map(),
  closed: false,
  writtenOff: 0,
  accounted: 0,
  drops: [],
  ...over,
});

/**
 * One sale, as answeredSalesByPair files it, dated late enough to reach every night in here.
 *
 * These fixtures' nights carry no `recordedAt`, which is a row from before the field and is eligible
 * for any sale. The eligibility rule has its own tests in piece-ledger.test.ts.
 */
const sold = (pieces: number, recordedAt = "2030-01-01T00:00:00Z") => [{ pieces, recordedAt }];

/** One boss row under a holder, owing you `pieces`. */
const owing = (lootId: string, bossKey: string, pieces: number, closed = false) => ({
  lootId,
  partyId: `pa-${lootId}`,
  bossKey,
  weekStart: "2026-08-06",
  droppedOn: "2026-08-06",
  looterName: "CreedBratton",
  pieces: pieces * 2,
  closed,
  transfers: [{ fromId: "person:p-bro", toId: "self", from: "Bro", to: "you", pieces }],
});

/** One boss row under YOUR OWN pile, where `pieces` of theirs are in your inventory. */
const holdingOf = (lootId: string, bossKey: string, pieces: number, closed = false) => ({
  lootId,
  partyId: `pa-${lootId}`,
  bossKey,
  weekStart: "2026-08-13",
  droppedOn: "2026-08-13",
  looterName: "HuskyxKenshi",
  pieces: pieces * 4,
  closed,
  transfers: [{ fromId: "self", toId: "person:p-bro", from: "you", to: "Bro", pieces }],
});

const line = (lootId: string, pay: number, direction: "owe" | "owed" = "owed"): WalletLine => ({
  partyId: `pa-${lootId}`,
  lootId,
  name: "Grindstone of Life",
  iconUrl: null,
  bossKey: "baldrix",
  droppedOn: "2026-08-08",
  direction,
  bought: false,
  mine: "mechyfechy",
  theirs: "CreedBratton",
  theirsId: `seat-${lootId}`,
  payeeId: `payee-${lootId}`,
  pay,
  nets: Math.floor(pay * 0.95),
  currency: "MESO",
});

const counterparty = (key: string, name: string, lines: WalletLine[]): Counterparty => {
  const owed = lines.filter((l) => l.direction === "owed").reduce((sum, l) => sum + l.pay, 0);
  const owe = lines.filter((l) => l.direction === "owe").reduce((sum, l) => sum + l.pay, 0);
  return {
    key,
    name,
    attributed: key.startsWith("person:"),
    owe,
    owed,
    net: owed - owe,
    usd: { owe: 0, owed: 0, net: 0 },
    lines,
  };
};

const wallet = (counterparties: Counterparty[]): Wallet => ({
  counterparties,
  owe: 0,
  owed: 0,
  net: 0,
  usd: { owe: 0, owed: 0, net: 0 },
  unreadable: 0,
  betweenOthers: 0,
  betweenMine: 0,
});

describe("what one person owes you", () => {
  it("puts pieces and shares on ONE row, since it is one person and one conversation", () => {
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M)])]),
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.name, rows[0]!.pieces, rows[0]!.mesos]).toEqual(["Bro", 80, 900 * M]);
  });

  it("states the pieces and never a price for them", () => {
    // The whole point of the redesign: coupons are single-trade, so what they are worth is not
    // something the app can see. A meso figure here would be a guess at somebody else's sale.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([]),
    );
    expect(rows[0]!.pieces).toBe(80);
    expect(rows[0]!.mesos).toBe(0);
    expect(Object.keys(rows[0]!)).not.toContain("piecesWorth");
  });

  it("counts only YOUR part of their pile, not everything they picked up", () => {
    // They are holding 160; 80 of those are yours. Their own half is their business.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([]),
    );
    expect(rows[0]!.drops[0]!.pieces).toBe(80);
  });

  it("says what of THEIRS you are holding, which is the half that pays a debt down", () => {
    // The ordinary night: you looted the lot, so their share is in your inventory. The card only
    // counted the other direction, so the figure the arrangement was made for was on no screen: the
    // whole point is that these coupons come off what they owe you.
    const rows = buildSettlement(
      [ledger(SELF, "you", { drops: [holdingOf("l1", "kalos-the-guardian", 30)] })],
      wallet([]),
    );
    expect([rows[0]!.name, rows[0]!.pieces, rows[0]!.piecesYouOwe]).toEqual(["Bro", 0, 30]);
  });

  it("cancels the two directions against each other before either is listed", () => {
    // Husky's week: 30 of Bro's off Kalos and 15 off Seren in your inventory, 20 of yours off
    // Baldrix in his. One handover settles the pair, so the 20 on each side is a night neither of you
    // has to do anything about, and it comes off BOTH lists rather than standing on each.
    const rows = buildSettlement(
      [
        ledger(SELF, "you", {
          drops: [holdingOf("l1", "kalos-the-guardian", 30), holdingOf("l2", "chosen-seren", 15)],
        }),
        ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l3", "baldrix", 20)] }),
      ],
      wallet([]),
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.pieces, rows[0]!.piecesYouOwe, rows[0]!.piecesNet]).toEqual([0, 25, 25]);
    // And the nights say the same, oldest first: Kalos gives up the 20, Seren is untouched.
    expect(rows[0]!.owedDrops.map((d) => d.pieces)).toEqual([10, 15]);
    expect(rows[0]!.drops.map((d) => d.pieces)).toEqual([0]);
  });

  it("cancels the nights a sale left, oldest first", () => {
    // The card as Jonathan read it: 60 of Bro's in your pile over two nights, 10 of them already sold
    // and offset, and 20 of yours in his. Kalos was down to 20 and Baldrix to 20, and both were
    // listed as outstanding when between them they were nothing. What is left is the later night
    // whole, which is the one figure that changes hands.
    const [row] = buildSettlement(
      [
        ledger(SELF, "you", {
          drops: [
            holdingOf("l1", "kalos-the-guardian", 30),
            { ...holdingOf("l2", "kaling", 30), droppedOn: "2026-08-14" },
          ],
        }),
        ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l3", "baldrix", 20)] }),
      ],
      wallet([]),
      [],
      new Map(),
      new Map(),
      new Map(),
      new Set(),
      new Map([[answeredKey("self", "person:p-bro"), sold(10)]]),
    );
    expect(row!.piecesNet).toBe(30);
    expect(row!.owedDrops.map((d) => d.pieces)).toEqual([0, 30]);
    expect(row!.drops.map((d) => d.pieces)).toEqual([0]);
  });

  it("keeps a cancelled night in the list at zero, so closing the pair still closes it", () => {
    // The same trap the answered nights have: a night that cancelled is finished and closing its
    // books is right, so dropping it from the list would take it out of settleThePair and leave it
    // open for ever. It is kept at zero and drawn in no row.
    const [row] = buildSettlement(
      [
        ledger(SELF, "you", { drops: [holdingOf("l1", "kalos-the-guardian", 30)] }),
        ledger(BRO, "Bro", { owedToYou: 30, drops: [owing("l2", "baldrix", 30)] }),
      ],
      wallet([counterparty("person:p-bro", "Bro", [line("l3", 900 * M)])]),
    );
    expect([row!.pieces, row!.piecesYouOwe, row!.piecesNet]).toEqual([0, 0, 0]);
    expect(closes(settleThePair(row!))).toBe(2);
  });

  it("nets the two directions into the one count that changes hands", () => {
    // Husky's week with Bro, in full: 90 of his in your inventory against 20 of yours in his. The
    // card said "20 pieces / 90 to hand over" and left the subtraction to whoever read it.
    const rows = buildSettlement(
      [
        ledger(SELF, "you", {
          drops: [
            holdingOf("l1", "kalos-the-guardian", 30),
            holdingOf("l2", "chosen-seren", 10),
            holdingOf("l3", "kaling", 20),
            holdingOf("l4", "malefic-star", 30),
          ],
        }),
        ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l5", "baldrix", 20)] }),
      ],
      wallet([]),
    );
    expect(rows[0]!.piecesNet).toBe(70);
  });

  it("nets the other way round when they are the ones holding more", () => {
    const rows = buildSettlement(
      [
        ledger(SELF, "you", { drops: [holdingOf("l1", "kalos-the-guardian", 10)] }),
        ledger(BRO, "Bro", { owedToYou: 30, drops: [owing("l2", "baldrix", 30)] }),
      ],
      wallet([]),
    );
    expect(rows[0]!.piecesNet).toBe(-20);
  });

  it("leaves a closed night out of what you are holding", () => {
    // Closed is settled, and counting it again would take it off a debt somebody already answered
    // for. The same rule the other direction has had since V52.
    const rows = buildSettlement(
      [ledger(SELF, "you", { drops: [holdingOf("l1", "kalos-the-guardian", 30, true)] })],
      wallet([]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("who belongs on the list at all", () => {
  it("leaves your own pile off, since you cannot owe yourself", () => {
    const rows = buildSettlement([ledger(SELF, "you", { pieces: 200 })], wallet([]));
    expect(rows).toEqual([]);
  });

  it("leaves a closed pile off, because it is finished", () => {
    const rows = buildSettlement(
      [
        ledger(BRO, "Bro", {
          owedToYou: 80,
          closed: true,
          drops: [owing("l1", "kalos", 80, true)],
        }),
      ],
      wallet([]),
    );
    expect(rows).toEqual([]);
  });

  it("leaves a closed BOSS off a pile that is still open", () => {
    const rows = buildSettlement(
      [
        ledger(BRO, "Bro", {
          owedToYou: 80,
          drops: [owing("l1", "kalos", 90, true), owing("l2", "first-adversary", 80)],
        }),
      ],
      wallet([]),
    );
    expect(rows[0]!.drops.map((d) => d.lootId)).toEqual(["l2"]);
  });

  it("keeps a share you owe THEM, said as what you owe rather than as something to collect", () => {
    // It used to be dropped, which was right while every figure here ran one way. It is not now:
    // the ordinary end of looting a boss single-handed is a debt of YOURS, and a card that showed
    // only the collectable direction would not mention the money of theirs in your hands.
    const rows = buildSettlement(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M, "owe")])]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou, rows[0]!.sharesYouOwe]).toEqual([0, 0, 900 * M]);
  });
});

describe("the two directions, which are said rather than netted", () => {
  it("keeps a share you owe out of what they owe you, so an offset has something to move", () => {
    // They owe you 1b of shares and you owe them 400m. One transfer of 600m is still how the pair
    // settles; the CARD says both, because which way the 400m goes is a decision nobody has made
    // yet: Offset takes it off the 1b, Mark sent does not. See sharesYouOwe.
    const rows = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 400 * M, "owe")]),
      ]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou, rows[0]!.sharesYouOwe]).toEqual([
      1_000 * M,
      0,
      400 * M,
    ]);
  });

  it("says both sides when the shares you owe are the bigger half", () => {
    // They record a sale owing you 1b and you owe them 1.5b. Neither figure swallows the other:
    // the offset that would net them is an act, and until it is pressed both are outstanding.
    const rows = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 1_500 * M, "owe")]),
      ]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou, rows[0]!.sharesYouOwe]).toEqual([
      1_000 * M,
      0,
      1_500 * M,
    ]);
  });

  it("says what you owe when their PIECES put them on the list anyway", () => {
    // So a pile is not chased off somebody you are 1.5b behind with.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l3", "first-adversary", 80)] })],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 1_500 * M, "owe")]),
      ]),
    );
    expect([rows[0]!.pieces, rows[0]!.mesos, rows[0]!.sharesYouOwe]).toEqual([
      80,
      1_000 * M,
      1_500 * M,
    ]);
  });

  it("carries the share lines when the only money is what you owe, so they can be settled", () => {
    // These used to be dropped, on the reasoning that settling what YOU owe did not belong on a
    // card about collecting. Retiring the Wallet took the only other place it could be done, and
    // Jonathan was left with four shares he owed and no settle anywhere in the app.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l3", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 1_500 * M, "owe")])]),
    );
    expect(rows[0]!.sharesYouOwe).toBe(1_500 * M);
    expect(sharesOf(rows[0]!)).toEqual([{ lootId: "l2", memberId: "payee-l2" }]);
  });

  it("settles BOTH directions when the net runs to you, since one transfer covers them", () => {
    const rows = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 400 * M, "owe")]),
      ]),
    );
    expect(sharesOf(rows[0]!).map((s) => s.lootId)).toEqual(["l1", "l2"]);
  });

  it("never nets a piece debt against a meso one", () => {
    // The two are not commensurable: a piece has no price until somebody names one, and the sides
    // come off different nights at different prices.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l3", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 400 * M, "owe")])]),
    );
    expect(rows[0]!.pieces).toBe(80);
    expect(rows[0]!.sharesYouOwe).toBe(400 * M);
  });

  it("keeps an unattributed character as their own row, rather than guessing", () => {
    const rows = buildSettlement(
      [ledger(STRANGER, "Zaddy", { owedToYou: 30, drops: [owing("l1", "limbo", 30)] })],
      wallet([]),
    );
    expect([rows[0]!.name, rows[0]!.attributed]).toEqual(["Zaddy", false]);
  });
});

describe("the order the rows come out in", () => {
  it("leads with the mesos, which is the half you can act on today", () => {
    const rows = buildSettlement(
      [
        ledger(BRO, "Bro", { owedToYou: 500, drops: [owing("l1", "kalos", 500)] }),
        ledger(STRANGER, "Zaddy", { owedToYou: 10, drops: [owing("l3", "limbo", 10)] }),
      ],
      wallet([counterparty("character:zaddy", "Zaddy", [line("l4", 900 * M)])]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Zaddy", "Bro"]);
  });

  it("breaks a tie on pieces, then the name, so two reads never disagree", () => {
    const rows = buildSettlement(
      [
        ledger(BRO, "Bro", { owedToYou: 10, drops: [owing("l1", "kalos", 10)] }),
        ledger(STRANGER, "Zaddy", { owedToYou: 80, drops: [owing("l2", "limbo", 80)] }),
      ],
      wallet([]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Zaddy", "Bro"]);
  });
});

describe("what a settle would touch", () => {
  it("names the payout rows of the shares, and nothing of the pieces", () => {
    // The trap this exists for: a piece debt has NO payout row, so naming one clears nothing while
    // looking as though it worked. That is why coupon debt was kept out of the wallet's lines.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M)])]),
    );
    expect(sharesOf(rows[0]!)).toEqual([{ lootId: "l2", memberId: "payee-l2" }]);
  });

  it("carries the holder for the piece side, which is what a payment is filed against", () => {
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([]),
    );
    expect(rows[0]!.holder).toEqual(BRO);
  });

  it("rebuilds the holder for somebody with no pile, so an entry can still be filed against them", () => {
    // It used to be null, which was fine while the only thing a card wrote was against a pile. An
    // entered debt is filed against the PERSON, and somebody who has never held a coupon can owe you.
    const rows = buildSettlement(
      [],
      wallet([counterparty("person:p-jared", "Jared", [line("l9", 400 * M)])]),
    );
    expect(rows[0]!.holder).toEqual({
      kind: "PERSON",
      personId: "p-jared",
      characterName: null,
    });
    expect(isEmpty(rows[0]!)).toBe(false);
  });
});

describe("the money a sale of somebody else's coupons puts on the card", () => {
  const debt = (holder: Holder, amount: number, note: string | null = null): SettlementDebt => ({
    id: `d-${amount}`,
    holder,
    amount,
    note,
    // A hand-entered debt discharges no share. Only an offset names any. See V58.
    payouts: [],
    incurredAt: "2026-08-10T00:00:00Z",
  });

  /** One decision about their money in your hands. See V61. */
  const disposal = (holder: Holder, amount: number, kind: "OFFSET" | "PAID"): ProceedsDisposal => ({
    id: `x-${kind}-${amount}`,
    holder,
    amount,
    kind,
    decidedAt: "2026-08-14T00:00:00Z",
  });

  it("owes them what their half of the lot fetched, the night you looted all of it", () => {
    // The case this was built for. 160 fell, 80 were theirs, you picked up the lot and sold it. Their
    // 80 came out of YOUR inventory at a price you typed, so their money is in your hands.
    const rows = buildSettlement(
      [],
      wallet([]),
      [],
      saleCredits([
        {
          id: "t1",
          holder: SELF,
          pieces: 160,
          amount: 4_000 * M,
          shares: [{ holder: BRO, pieces: 80 }],
        },
      ]),
      new Map(),
      new Map([["person:p-bro", "Bro"]]),
    );
    // HOLDING, not owed. Their money is in your hands and what becomes of it is the pair's to say.
    expect([rows[0]!.name, rows[0]!.holding, rows[0]!.owedByYou]).toEqual(["Bro", 2_000 * M, 0]);
  });

  it("does NOT deduct that sale from what they owe you until somebody says to", () => {
    // The behaviour V61 took away. Their 3b debt stood, their 2b sat in your hands, and the card put
    // the two together and called it 1b: an offset nobody agreed to. Bro may want the mesos.
    const rows = buildSettlement(
      [],
      wallet([]),
      [debt(BRO, 3_000 * M, "Ludi loan")],
      saleCredits([
        {
          id: "t1",
          holder: SELF,
          pieces: 160,
          amount: 4_000 * M,
          shares: [{ holder: BRO, pieces: 80 }],
        },
      ]),
    );
    expect(rows[0]!.mesos).toBe(3_000 * M);
    expect([rows[0]!.parts.entered, rows[0]!.parts.soldOfTheirs]).toEqual([3_000 * M, 0]);
    expect(rows[0]!.holding).toBe(2_000 * M);
  });

  it("deducts it once an OFFSET is recorded, which is the same net, chosen", () => {
    const rows = buildSettlement(
      [],
      wallet([]),
      [debt(BRO, 3_000 * M, "Ludi loan")],
      saleCredits([
        {
          id: "t1",
          holder: SELF,
          pieces: 160,
          amount: 4_000 * M,
          shares: [{ holder: BRO, pieces: 80 }],
        },
      ]),
      new Map(),
      new Map(),
      new Set(),
      new Map(),
      [disposal(BRO, 2_000 * M, "OFFSET")],
    );
    expect(rows[0]!.mesos).toBe(1_000 * M);
    expect([rows[0]!.parts.soldOfTheirs, rows[0]!.holding]).toEqual([-2_000 * M, 0]);
  });

  it("leaves their debt alone when you PAID them instead", () => {
    // The other half of the choice, and the reason it had to become one. The money left you and what
    // Bro owes you never moved.
    const rows = buildSettlement(
      [],
      wallet([]),
      [debt(BRO, 3_000 * M, "Ludi loan")],
      saleCredits([
        {
          id: "t1",
          holder: SELF,
          pieces: 160,
          amount: 4_000 * M,
          shares: [{ holder: BRO, pieces: 80 }],
        },
      ]),
      new Map(),
      new Map(),
      new Set(),
      new Map(),
      [disposal(BRO, 2_000 * M, "PAID")],
    );
    expect(rows[0]!.mesos).toBe(3_000 * M);
    expect([rows[0]!.parts.soldOfTheirs, rows[0]!.holding]).toEqual([0, 0]);
  });

  it("caps a decision at what you are holding, so a mistyped one cannot invent a credit", () => {
    const rows = buildSettlement(
      [],
      wallet([]),
      [debt(BRO, 3_000 * M, "Ludi loan")],
      saleCredits([
        {
          id: "t1",
          holder: SELF,
          pieces: 160,
          amount: 4_000 * M,
          shares: [{ holder: BRO, pieces: 80 }],
        },
      ]),
      new Map(),
      new Map(),
      new Set(),
      new Map(),
      [disposal(BRO, 9_000 * M, "OFFSET")],
    );
    expect([rows[0]!.parts.soldOfTheirs, rows[0]!.holding]).toEqual([-2_000 * M, 0]);
  });

  it("prices only the pieces that were said to be theirs, never the whole sale", () => {
    // A partial sale: 100 of the 160 went, and 80 of those were theirs because somebody typed 80.
    // Nothing infers which coupons in one inventory went to market.
    const rows = buildSettlement(
      [],
      wallet([]),
      [],
      saleCredits([
        {
          id: "t1",
          holder: SELF,
          pieces: 100,
          amount: 2_500 * M,
          shares: [{ holder: BRO, pieces: 80 }],
        },
      ]),
    );
    expect(rows[0]!.holding).toBe(2_000 * M);
  });

  it("credits nobody for a sale that named no shares, which is every row before V56", () => {
    const rows = buildSettlement(
      [],
      wallet([]),
      [],
      saleCredits([{ id: "t1", holder: SELF, pieces: 160, amount: 4_000 * M }]),
    );
    expect(rows).toEqual([]);
  });

  it("divides no redemption, which realized nothing to share", () => {
    // The server refuses shares on one too; this is the reader agreeing with it.
    const credits = saleCredits([
      { id: "t1", holder: SELF, pieces: 80, amount: null, shares: [{ holder: BRO, pieces: 80 }] },
    ]);
    expect(credits.size).toBe(0);
  });

  it("divides a purchase, at the price it names", () => {
    // "I took theirs, at a price" is the act of keeping somebody's coupons instead of handing them
    // back. Leaving it out settled the pieces and stated the money for them nowhere.
    const credits = saleCredits([
      {
        id: "t1",
        holder: SELF,
        pieces: 80,
        amount: 2_000 * M,
        disposition: "BOUGHT",
        shares: [{ holder: BRO, pieces: 80 }],
      },
    ]);
    expect(credits.get("person:p-bro")).toEqual({
      toThem: 2_000 * M,
      toYou: 0,
      sales: [
        {
          trancheId: "t1",
          pieces: 80,
          mesos: 2_000 * M,
          lot: { pieces: 80, amount: 2_000 * M },
          soldAt: null,
        },
      ],
    });
  });

  it("divides a purchase that took only part of the pile, pro rata", () => {
    // The same arithmetic a sale gets. Half the pieces named means half the agreed price, and the
    // rest of the tranche was the buyer's own to begin with.
    const credits = saleCredits([
      {
        id: "t1",
        holder: SELF,
        pieces: 80,
        amount: 2_000 * M,
        disposition: "BOUGHT",
        shares: [{ holder: BRO, pieces: 40 }],
      },
    ]);
    expect(credits.get("person:p-bro")).toEqual({
      toThem: 1_000 * M,
      toYou: 0,
      sales: [
        {
          trancheId: "t1",
          pieces: 40,
          mesos: 1_000 * M,
          lot: { pieces: 80, amount: 2_000 * M },
          soldAt: null,
        },
      ],
    });
  });

  it("leaves a sale between two other people alone, since settling it is not yours", () => {
    // The same treatment buildWallet gives betweenOthers. Real, and not a debt of yours either way.
    const credits = saleCredits([
      {
        id: "t1",
        holder: BRO,
        pieces: 80,
        amount: 2_000 * M,
        shares: [{ holder: STRANGER, pieces: 80 }],
      },
    ]);
    expect(credits.size).toBe(0);
  });

  it("takes a payment off what they owe, whether or not they ever held a coupon", () => {
    // Received used to be read off the HolderLedger, so a person with no open drop had none at all.
    const rows = buildSettlement(
      [],
      wallet([]),
      [debt(BRO, 1_000 * M)],
      new Map(),
      new Map([["person:p-bro", 400 * M]]),
    );
    expect([rows[0]!.mesos, rows[0]!.parts.received]).toEqual([600 * M, -400 * M]);
  });

  it("never turns a payment into a debt of YOURS, when the pieces it paid for have no price", () => {
    // They hold 80 of yours and send 400m for them. Netting that would read "you owe them 400m",
    // which is the plausible confident wrong number: the pieces have no price for it to come off.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
      [],
      new Map(),
      new Map([["person:p-bro", 400 * M]]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou]).toEqual([0, 0]);
    expect([rows[0]!.parts.received, rows[0]!.receivedOnPieces]).toEqual([0, 400 * M]);
  });

  it("spends a payment on the priced debt first, and says what is left over", () => {
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
      [debt(BRO, 500 * M)],
      new Map(),
      new Map([["person:p-bro", 900 * M]]),
    );
    expect(rows[0]!.mesos).toBe(0);
    expect([rows[0]!.parts.received, rows[0]!.receivedOnPieces]).toEqual([-500 * M, 400 * M]);
  });

  it("spends a payment that already closed a pile, so it cannot pay for the next debt", () => {
    // Jonathan's live data, 2026-08-12. Bro sold 195 coupons for 4.856b, sent 4.86b, and the pile
    // was settled twenty minutes later. Counted raw, that finished payment came straight off the
    // 254b entered against him today. #350's rule, one ledger further along: a closed thing counts
    // towards no current total.
    const paid = [
      { holder: BRO, amount: 4_860 * M, receivedAt: "2026-08-10T22:01:46Z" },
      { holder: BRO, amount: 500 * M, receivedAt: "2026-08-11T09:00:00Z" },
    ];
    const closed = [{ holder: BRO, settledAt: "2026-08-10T22:21:53Z" }];

    // Only the one that arrived after the books closed.
    expect(receivedSinceClosing(paid, closed)).toEqual(new Map([["person:p-bro", 500 * M]]));

    const rows = buildSettlement(
      [],
      wallet([]),
      [debt(BRO, 254_000 * M)],
      new Map(),
      receivedSinceClosing(paid, closed),
    );
    expect(rows[0]!.mesos).toBe(253_500 * M);
  });

  it("counts every payment when no pile has ever been closed", () => {
    const paid = [{ holder: BRO, amount: 400 * M, receivedAt: "2026-08-10T22:01:46Z" }];
    expect(receivedSinceClosing(paid, [])).toEqual(new Map([["person:p-bro", 400 * M]]));
  });

  it("closes one person's books without spending another's payments", () => {
    const paid = [
      { holder: BRO, amount: 400 * M, receivedAt: "2026-08-10T22:01:46Z" },
      { holder: STRANGER, amount: 900 * M, receivedAt: "2026-08-10T22:01:46Z" },
    ];
    const closed = [{ holder: BRO, settledAt: "2026-08-10T23:00:00Z" }];
    expect(receivedSinceClosing(paid, closed)).toEqual(new Map([["character:zaddy", 900 * M]]));
  });

  // The card lists receipts one by one, so it needs the receipts and not their sum: a spent one is
  // in no arithmetic on the card, and drawing it in the list would make the parts come to more than
  // the net. See Receipts.
  it("hands the card each receipt, split by the closure that spent it", () => {
    const paid = [
      { id: "p2", holder: BRO, amount: 500 * M, receivedAt: "2026-08-11T09:00:00Z" },
      { id: "p1", holder: BRO, amount: 4_860 * M, receivedAt: "2026-08-10T22:01:46Z" },
    ];
    const closed = [{ holder: BRO, settledAt: "2026-08-10T22:21:53Z" }];
    const split = paymentsSinceClosing(paid, closed).get("person:p-bro");
    expect([split?.counted.map((r) => r.id), split?.spent.map((r) => r.id)]).toEqual([
      ["p2"],
      ["p1"],
    ]);
  });

  it("hands them over oldest first, the order the money moved in", () => {
    const paid = [
      { id: "late", holder: BRO, amount: 500 * M, receivedAt: "2026-08-12T09:00:00Z" },
      { id: "early", holder: BRO, amount: 400 * M, receivedAt: "2026-08-11T09:00:00Z" },
    ];
    expect(
      paymentsSinceClosing(paid, [])
        .get("person:p-bro")
        ?.counted.map((r) => r.id),
    ).toEqual(["early", "late"]);
  });

  it("takes a share you owe off what they owe you, the moment it is OFFSET against theirs", () => {
    // The settlement two people actually make when the sums are lopsided: rather than send 139m and
    // have 254b come back, it comes off the larger figure. Both real rows off Jonathan's account.
    //
    // The figure MOVES here, and that is the whole act. It used to be netted before anybody agreed
    // to it, so the two halves of the offset cancelled and pressing the button changed nothing on
    // screen. Marking the share paid alone still says the money moved, which is Mark sent. See V57.
    const share = counterparty("person:p-bro", "Bro", [line("l9", 139_548_023, "owe")]);

    // Outstanding: what he owes you, whole, with your share beside it rather than inside it.
    const before = buildSettlement([], wallet([share]), [debt(BRO, 254_512_697_574)]);
    expect([before[0]!.mesos, before[0]!.sharesYouOwe]).toEqual([254_512_697_574, 139_548_023]);

    // Offset: the share is paid AND a negative adjustment records what discharged it.
    const after = buildSettlement([], wallet([]), [
      debt(BRO, 254_512_697_574),
      debt(BRO, -139_548_023, "offset against Bro"),
    ]);
    expect([after[0]!.mesos, after[0]!.sharesYouOwe]).toEqual([254_512_697_574 - 139_548_023, 0]);
  });

  it("says you owe when an offset is the only thing on the card", () => {
    // A negative with nothing to come off is not an offset, it is a debt of yours, and it is said
    // rather than hidden. The card offers no offset in that state; this is only the arithmetic.
    const rows = buildSettlement([], wallet([]), [debt(BRO, -139_548_023, "offset against Bro")]);
    expect([rows[0]!.mesos, rows[0]!.owedByYou]).toEqual([0, 139_548_023]);
  });

  it("keeps the pieces out of the net, however much money is on the card", () => {
    // The rule this ledger was split for. A piece has no price until somebody names one, so it is
    // never added to or taken off a meso figure.
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
      [debt(BRO, 1_000 * M)],
    );
    expect([rows[0]!.pieces, rows[0]!.mesos]).toEqual([80, 1_000 * M]);
  });

  it("rounds a creditor's slice to the meso and leaves the remainder with the seller", () => {
    // 1 of 3 pieces out of 1000 mesos. The two sides must add up to the tranche exactly, and the
    // person who typed the figure is the one who can check it.
    const credits = saleCredits([
      { id: "t1", holder: SELF, pieces: 3, amount: 1_000, shares: [{ holder: BRO, pieces: 1 }] },
    ]);
    expect(credits.get("person:p-bro")).toEqual({
      toThem: 333,
      toYou: 0,
      sales: [
        { trancheId: "t1", pieces: 1, mesos: 333, lot: { pieces: 3, amount: 1_000 }, soldAt: null },
      ],
    });
  });
});

describe("what the account comes to, above the cards", () => {
  it("sums the CARDS, so a tile cannot disagree with the list under it", () => {
    // The Wallet had its own pass over the pools for this, which is how two surfaces get two
    // answers. These are the same rows the list draws.
    const rows = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M)]),
        counterparty("character:zaddy", "Zaddy", [line("l2", 400 * M, "owe")]),
      ]),
    );
    expect(settlementTotals(rows)).toEqual({
      owed: 1_000 * M,
      owe: 400 * M,
      net: 600 * M,
      people: 2,
      usd: { owe: 0, owed: 0, net: 0 },
    });
  });

  it("still nets one person's two directions in the strip, which the cards no longer do", () => {
    // The card says 1b owed with 400m of yours beside it, because which way that 400m goes is an
    // act nobody has performed. The account's position is not a decision, so the strip subtracts:
    // one transfer of 600m is what standing between the two of you comes to.
    //
    // The tile is what checks this change did not lose a figure. Netting moved out of the cards and
    // the totals are summed off those cards, so Net is the one place the two sides still meet.
    const rows = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 400 * M, "owe")]),
      ]),
    );
    expect(settlementTotals(rows)).toEqual({
      owed: 1_000 * M,
      owe: 400 * M,
      net: 600 * M,
      people: 1,
      usd: { owe: 0, owed: 0, net: 0 },
    });
  });

  it("says you are behind overall when the net runs against you", () => {
    const rows = buildSettlement(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l1", 900 * M, "owe")])]),
    );
    expect(settlementTotals(rows).net).toBe(-900 * M);
  });

  it("counts no pieces, since a count cannot be added to a total of mesos", () => {
    const rows = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
    );
    expect(settlementTotals(rows)).toEqual({
      owed: 0,
      owe: 0,
      net: 0,
      people: 1,
      usd: { owe: 0, owed: 0, net: 0 },
    });
  });
});

describe("marking a share you owe as actually sent", () => {
  it("names only the shares YOU owe, never what they owe you", () => {
    // sharesOf is every line. On a card running both ways it would mark what they owe you paid at
    // the same time, and say you had collected money nobody has sent.
    const rows = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 400 * M, "owe")]),
      ]),
    );
    expect(owedByYouShares(rows[0]!)).toEqual([{ lootId: "l2", memberId: "payee-l2" }]);
    expect(sharesOf(rows[0]!)).toHaveLength(2);
  });

  it("is there for a card whose every share runs against you", () => {
    // The gap left when Settle was pulled off such a card: Jared's read "you owe 289,382,716" with
    // nothing to do about it, which is a ledger you cannot keep.
    const rows = buildSettlement(
      [],
      wallet([counterparty("person:p-jared", "Jared", [line("l3", 289 * M, "owe")])]),
    );
    expect(owedByYouShares(rows[0]!)).toHaveLength(1);
  });
});

describe("discharging what you owe against what they owe you", () => {
  /** One entered row against Bro. Negative is a debt of yours discharged against it. See V57. */
  const debt = (amount: number): SettlementDebt => ({
    id: `d-${amount}`,
    holder: BRO,
    amount,
    note: null,
    payouts: [],
    incurredAt: "2026-08-10T00:00:00Z",
  });

  /** Bro owes `entered`, and you owe him `share` out of a drop you sold. */
  const card = (entered: number, share: number) =>
    buildSettlement(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l1", share, "owe")])]),
      entered > 0 ? [debt(entered)] : [],
    )[0]!;

  it("comes off the debt, which is a figure that moves by exactly the shares it discharged", () => {
    const row = card(2_000 * M, 500 * M);
    expect([row.mesos, row.sharesYouOwe]).toEqual([2_000 * M, 500 * M]);
    const offset = offsetOf(row);
    expect(offset).toEqual({
      parts: [{ lootId: "l1", memberId: "payee-l1", amount: 500 * M }],
      amount: 500 * M,
      toComeOff: 2_000 * M,
      leftOwing: 0,
      offered: true,
    });
    // The act writes -amount and marks those shares paid. The card said 2b before and says 1.5b
    // after, which is the agreement the two of you made showing up in the one figure you act on.
    const after = buildSettlement([], wallet([]), [debt(2_000 * M), debt(-offset.amount)])[0]!;
    expect([after.mesos, after.sharesYouOwe]).toEqual([1_500 * M, 0]);
  });

  it("never reads low between its two writes, which is why the card draws them as one", () => {
    // The settle lands first and marks the shares paid; the debt row that takes them off what he
    // owes you is a round trip behind it. A card drawn between the two says 2b, which is where it
    // started: the figure falls when the offset is recorded and not before. A failure in the gap
    // leaves the shares paid and nothing off the debt, so both go in one request. See onOffsetShares.
    const row = card(2_000 * M, 500 * M);
    const between = buildSettlement([], wallet([]), [debt(2_000 * M)])[0]!;
    expect(between.mesos).toBe(row.mesos);
    expect(between.sharesYouOwe).toBe(0);
  });

  it("is offered when the shares outgrow the debt, and says what it leaves you owing", () => {
    // The night this button was for and refused: you take a week of his coupons, they come to more
    // than he owed, and the remainder is yours to send.
    const row = card(500 * M, 800 * M);
    expect([row.mesos, row.owedByYou, row.sharesYouOwe]).toEqual([500 * M, 0, 800 * M]);
    expect(offsetOf(row)).toEqual({
      parts: [{ lootId: "l1", memberId: "payee-l1", amount: 800 * M }],
      amount: 800 * M,
      toComeOff: 500 * M,
      leftOwing: 300 * M,
      offered: true,
    });
  });

  it("turns the card over to what you owe on a partial one, by what it could not cover", () => {
    const row = card(500 * M, 800 * M);
    const after = buildSettlement([], wallet([]), [debt(500 * M), debt(-800 * M)])[0]!;
    // The 300m the button promised, now the only thing on the card.
    expect([after.mesos, after.owedByYou]).toEqual([0, offsetOf(row).leftOwing]);
  });

  it("is refused when they owe you nothing, which is not an offset but a debt of yours", () => {
    const row = card(0, 800 * M);
    expect(offsetOf(row)).toEqual({
      parts: [{ lootId: "l1", memberId: "payee-l1", amount: 800 * M }],
      amount: 800 * M,
      toComeOff: 0,
      leftOwing: 800 * M,
      offered: false,
    });
  });

  it("names every share it covers, each with its own figure", () => {
    // What the ledger writes a row from. Three nights against Bro were ONE entry reading 5.6b and
    // "offset against Bro", with which three a fold down from a figure that named none of them.
    const row = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [
          line("l1", 1_933 * M, "owe"),
          line("l2", 372 * M, "owe"),
          line("l3", 861 * M, "owe"),
        ]),
      ]),
      [debt(9_000 * M)],
    )[0]!;
    const offset = offsetOf(row);
    expect(offset.parts).toEqual([
      { lootId: "l1", memberId: "payee-l1", amount: 1_933 * M },
      { lootId: "l2", memberId: "payee-l2", amount: 372 * M },
      { lootId: "l3", memberId: "payee-l3", amount: 861 * M },
    ]);
    // The button says one figure and the rows say three. They are the same act, so they add up.
    expect(offset.parts.reduce((sum, part) => sum + part.amount, 0)).toBe(offset.amount);
  });

  it("leaves a share they owe YOU out of the parts, the way it leaves it out of the amount", () => {
    // Handed every line it would write an offset row against money nobody has sent. See
    // owedByYouShares for the same trap one act along.
    const row = buildSettlement(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [
          line("l1", 500 * M, "owe"),
          line("l2", 700 * M, "owed"),
        ]),
      ]),
      [],
    )[0]!;
    expect(offsetOf(row).parts).toEqual([{ lootId: "l1", memberId: "payee-l1", amount: 500 * M }]);
  });

  it("is refused when no share of yours is outstanding", () => {
    const row = buildSettlement([], wallet([]), [debt(2_000 * M)])[0]!;
    expect(offsetOf(row).offered).toBe(false);
  });

  it("counts a coupon sale of theirs as something to come off, ONCE it has been offset", () => {
    // Their pieces sold out of your pile are money of theirs in your hands, so an offset against it
    // would be backwards. It belongs in `toComeOff` with the sign it already has, from the moment
    // somebody says it comes off his debt rather than being sent to him. See V61.
    const proceeds = saleCredits([
      {
        id: "t1",
        holder: SELF,
        pieces: 80,
        amount: 800 * M,
        shares: [{ holder: BRO, pieces: 40 }],
      },
    ]);
    const card = (disposals: ProceedsDisposal[]) =>
      buildSettlement(
        [],
        wallet([counterparty("person:p-bro", "Bro", [line("l1", 200 * M, "owe")])]),
        [debt(2_000 * M)],
        proceeds,
        new Map(),
        new Map(),
        new Set(),
        new Map(),
        disposals,
      )[0]!;

    // Undecided, his 400m is in your hands and out of the net, and so is the 200m share you owe:
    // two decisions nobody has made, neither of them touching the 2b entered.
    const undecided = card([]);
    expect([undecided.mesos, undecided.holding, undecided.sharesYouOwe]).toEqual([
      2_000 * M,
      400 * M,
      200 * M,
    ]);

    // Offset, and it comes off: 2b entered, less 400m of his coupons you sold. The share is still
    // its own decision, and still outside the figure.
    const offset = card([
      {
        id: "x1",
        holder: BRO,
        amount: 400 * M,
        kind: "OFFSET",
        decidedAt: "2026-08-14T00:00:00Z",
      },
    ]);
    expect(offset.mesos).toBe(1_600 * M);
    expect(offsetOf(offset).toComeOff).toBe(1_600 * M);
    expect(offsetOf(offset).leftOwing).toBe(0);
  });
});

describe("a person whose card is kept", () => {
  it("draws a card with nothing on it, which is where next week's entry goes", () => {
    const rows = buildSettlement(
      [],
      wallet([]),
      [],
      new Map(),
      new Map(),
      new Map([["person:p-bro", "Bro"]]),
      new Set(["person:p-bro"]),
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.name, rows[0]!.pinned, rows[0]!.mesos]).toEqual(["Bro", true, 0]);
  });

  it("still leaves off somebody nobody pinned and nothing is owed to", () => {
    const rows = buildSettlement([], wallet([]), [], new Map(), new Map(), new Map(), new Set());
    expect(rows).toEqual([]);
  });

  it("marks a pinned person who DOES owe you, rather than drawing them twice", () => {
    const rows = buildSettlement(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l1", 900 * M)])]),
      [],
      new Map(),
      new Map(),
      new Map(),
      new Set(["person:p-bro"]),
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.pinned, rows[0]!.mesos]).toEqual([true, 900 * M]);
  });
});

describe("which piles the Sale Ledger draws", () => {
  it("keeps yours, which are the only ones you can sell out of", () => {
    expect(yourPiles([ledger(SELF, "you")])).toHaveLength(1);
  });

  it("drops somebody else's pile", () => {
    // Every debt is stated on the Settlement Ledger, in pieces, and nowhere else: two cards claiming
    // what one person owes is two answers. Their rows were kept here while the old entry shape's
    // tranches still existed and could be corrected nowhere else. Both are gone.
    expect(yourPiles([ledger(BRO, "Bro")])).toEqual([]);
  });

  it("keeps only yours out of a mixed list", () => {
    const all = [ledger(SELF, "you"), ledger(BRO, "Bro"), ledger(STRANGER, "Zaddy")];
    expect(yourPiles(all).map((l) => l.holderName)).toEqual(["you"]);
  });
});

describe("what builds the debt, and what has come off it", () => {
  const entry = (
    id: string,
    amount: number,
    note: string | null,
    payouts: { lootId: string; memberId: string }[] = [],
  ): SettlementDebt => ({ id, holder: BRO, amount, note, payouts, incurredAt: `2026-08-${id}` });

  const card = (entries: SettlementDebt[], disposals: ProceedsDisposal[] = []) =>
    buildSettlement(
      [],
      wallet([]),
      entries,
      new Map([["person:p-bro", { toThem: 5_000 * M, toYou: 0, sales: [] }]]),
      new Map(),
      new Map([["person:p-bro", "Bro"]]),
      new Set(),
      new Map(),
      disposals,
    )[0]!;

  it("keeps a typed debt in the owed list and takes the offsets out", () => {
    // The card Jonathan was reading: one line saying what Bro owed, buried under two saying what had
    // come off, all four looking like the same kind of thing.
    const rows = moneyRows(
      card([
        entry("12", 254_512 * M, "oath + secondary"),
        entry("13", -139 * M, "offset against Bro", [{ lootId: "l1", memberId: "m1" }]),
        entry("14", -1_180 * M, "offset against Bro", [{ lootId: "l2", memberId: "m2" }]),
      ]),
    );
    expect(rows.typed.map((e) => e.note)).toEqual(["oath + secondary"]);
    expect(rows.discharges.map((d) => d.source)).toEqual(["DEBT", "DEBT"]);
    expect(rows.discharged).toBe(1_319 * M);
  });

  // The claim the two figures on the card make together: what `Owed` heads, less what `Offsets`
  // heads, is the header. Both are sums of their own drawn rows, so this is the one place the three
  // can be checked against each other, and the identity is what stops a fourth spelling appearing.
  //
  // `parts.entered` is not the same as the typed rows: a NEGATIVE entry is a discharge and leaves
  // the owed list, so the two lists split it between them and only together come back to `priced`.
  it("has the owed rows less the offsets come to exactly the headline", () => {
    const row = card(
      [
        entry("12", 254_512 * M, "oath + secondary"),
        entry("13", -139 * M, "offset against Bro", [{ lootId: "l1", memberId: "m1" }]),
        entry("14", -900 * M, "sent him too much"),
      ],
      [{ id: "d1", holder: BRO, amount: 2_000 * M, kind: "OFFSET", decidedAt: "2026-08-20" }],
    );
    const rows = moneyRows(row);
    // What the component's `owedTotal` sums: the priced parts it draws, plus the typed debts.
    const owedTotal =
      row.parts.shares +
      row.parts.soldOfYours +
      rows.typed.reduce((sum, entry) => sum + entry.amount, 0);
    // And what buildSettlement calls `priced`, which the header is the positive side of.
    expect(owedTotal - rows.discharged).toBe(row.mesos - row.owedByYou);
  });

  it("counts a credit typed by hand as a discharge, whatever it names", () => {
    // V57 made the entry signed, so a negative can arrive with no share behind it. Left in the owed
    // list it would read as a debt of minus a billion.
    const rows = moneyRows(card([entry("12", -900 * M, "sent him too much")]));
    expect([rows.typed.length, rows.discharged]).toEqual([0, 900 * M]);
  });

  it("folds a coupon-sale offset in with the rest, one place for one kind of fact", () => {
    const rows = moneyRows(
      card(
        [entry("12", 5_000 * M, "oath")],
        [
          {
            id: "x1",
            holder: BRO,
            amount: 2_412 * M,
            kind: "OFFSET",
            decidedAt: "2026-08-15",
          },
        ],
      ),
    );
    expect(rows.discharges.map((d) => [d.source, d.amount])).toEqual([["PROCEEDS", 2_412 * M]]);
  });

  it("leaves a payment OUT to them off the list, it having taken nothing off", () => {
    // Sending them their own money discharged what you were holding, not what they owe you. Counting
    // it here would say their debt had fallen by money that never touched it.
    const rows = moneyRows(
      card(
        [entry("12", 5_000 * M, "oath")],
        [{ id: "x1", holder: BRO, amount: 2_412 * M, kind: "PAID", decidedAt: "2026-08-15" }],
      ),
    );
    expect([rows.discharges, rows.discharged]).toEqual([[], 0]);
  });

  it("loses nothing, so the two lists always account for every entry", () => {
    const entries = [
      entry("12", 5_000 * M, "oath"),
      entry("13", -139 * M, null, [{ lootId: "l1", memberId: "m1" }]),
      entry("14", 200 * M, "a loan"),
    ];
    const rows = moneyRows(card(entries));
    expect(rows.typed.length + rows.discharges.length).toBe(entries.length);
  });

  it("puts the newest act first, a history being read from the top", () => {
    const rows = moneyRows(
      card(
        [entry("12", -100 * M, "older", [{ lootId: "l1", memberId: "m1" }])],
        [{ id: "x1", holder: BRO, amount: 200 * M, kind: "OFFSET", decidedAt: "2026-08-20" }],
      ),
    );
    expect(rows.discharges.map((d) => d.label)).toEqual(["coupon sale", "older"]);
  });

  // Money they SENT came off what they owe exactly as an offset does. It used to be one unlabelled
  // "received" line in the owed list, saying the sum of every receipt and nothing about any of them,
  // while the note it was entered with was legible only on a pill under the form.
  it("takes a receipt as an act of its own, under the note it was entered with", () => {
    const rows = moneyRows(card([entry("12", 5_000 * M, "oath")]), [
      { id: "g1", amount: 210 * M, note: "20 stars", receivedAt: "2026-08-21T00:07:02Z" },
    ]);
    expect(rows.discharges.map((d) => [d.source, d.label, d.amount])).toEqual([
      ["PAYMENT", "20 stars", 210 * M],
    ]);
    expect(rows.discharged).toBe(210 * M);
  });

  it("still names a receipt entered with no note", () => {
    const rows = moneyRows(card([entry("12", 5_000 * M, "oath")]), [
      { id: "g1", amount: 210 * M, note: null, receivedAt: "2026-08-21T00:07:02Z" },
    ]);
    expect(rows.discharges.map((d) => d.label)).toEqual(["paid"]);
  });

  it("dates a receipt among the offsets rather than after them", () => {
    const rows = moneyRows(
      card([entry("22", -100 * M, "newer", [{ lootId: "l1", memberId: "m1" }])]),
      [{ id: "g1", amount: 210 * M, note: "20 stars", receivedAt: "2026-08-21T00:07:02Z" }],
    );
    expect(rows.discharges.map((d) => d.label)).toEqual(["newer", "20 stars"]);
  });
});

describe("the coupon sales behind a decision", () => {
  /** One tranche that was all theirs, which is the ordinary night. */
  const sale = (id: string, pieces: number, mesos: number, soldAt: string): CouponSale => ({
    trancheId: id,
    pieces,
    mesos,
    lot: { pieces, amount: mesos },
    soldAt,
  });

  const decided = (
    id: string,
    amount: number,
    kind: "OFFSET" | "PAID" = "OFFSET",
  ): ProceedsDisposal => ({ id, holder: BRO, amount, kind, decidedAt: `2026-08-${id}` });

  /** Bro's card: sales of his coupons out of your pile, and what has been decided about the money. */
  const card = (sales: CouponSale[], disposals: ProceedsDisposal[]) =>
    buildSettlement(
      [],
      wallet([]),
      [],
      new Map([
        ["person:p-bro", { toThem: sales.reduce((sum, s) => sum + s.mesos, 0), toYou: 0, sales }],
      ]),
      new Map(),
      new Map([["person:p-bro", "Bro"]]),
      new Set(),
      new Map(),
      disposals,
    )[0]!;

  it("names them, so 2.41b off Bro's debt says it was 130 coupons", () => {
    // Jonathan's own card. One Offset, taken on the whole undecided pile, made of two nights' sales:
    // the row said "coupon sale" and the count was on no screen at all.
    const rows = moneyRows(
      card(
        [sale("t1", 70, 1_298_888_850, "2026-08-14"), sale("t2", 60, 1_113_333_300, "2026-08-14")],
        [decided("15", 2_412_222_150)],
      ),
    );
    expect(rows.discharges[0]!.sales.map((s) => s.pieces)).toEqual([70, 60]);
  });

  it("says nothing about the parts of a decision the sales cannot account for", () => {
    // Part of a sale cannot say which coupons it was, and "70 coupons" beside 400m of a 1.3b sale is
    // a wrong number wearing an itemisation. The figure stands and the row makes no claim.
    const rows = moneyRows(
      card([sale("t1", 70, 1_000 * M, "2026-08-14")], [decided("15", 400 * M)]),
    );
    expect([rows.discharges[0]!.amount, rows.discharges[0]!.sales]).toEqual([400 * M, []]);
  });

  it("does not hand a later decision the sales a payment out has already spent", () => {
    // A payment out gets no row of its own, having taken nothing off what they owe you, but it did
    // spend money you were holding. Shown the offsets alone this would name the first sale twice.
    const rows = moneyRows(
      card(
        [sale("t1", 70, 1_000 * M, "2026-08-14"), sale("t2", 120, 2_000 * M, "2026-08-15")],
        [decided("15", 1_000 * M, "PAID"), decided("16", 2_000 * M)],
      ),
    );
    expect(rows.discharges.map((d) => d.sales.map((s) => s.pieces))).toEqual([[120]]);
  });

  it("stops at the decision the alignment goes, rather than guessing past it", () => {
    const rows = moneyRows(
      card(
        [sale("t1", 70, 1_000 * M, "2026-08-14"), sale("t2", 120, 2_000 * M, "2026-08-15")],
        [decided("15", 400 * M), decided("16", 2_600 * M)],
      ),
    );
    expect(rows.discharges.map((d) => d.sales.length)).toEqual([0, 0]);
  });

  // What the Sale Ledger folds on. The same match, so a sale the Settlement card says was offset and
  // a pill the Sale Ledger holds back are the same sale.
  /** The sales of one person's coupons, as saleCredits hands them over. */
  const held = (sales: CouponSale[]) =>
    new Map([
      ["person:p-bro", { toThem: sales.reduce((sum, s) => sum + s.mesos, 0), toYou: 0, sales }],
    ]);

  it("names the sales that are finished, and who they were finished with", () => {
    const out = decidedSales(
      held([
        sale("t1", 70, 1_298_888_850, "2026-08-14"),
        sale("t2", 60, 1_113_333_300, "2026-08-14"),
      ]),
      [decided("15", 2_412_222_150)],
    );
    expect([...out]).toEqual([
      ["t1", new Set(["person:p-bro"])],
      ["t2", new Set(["person:p-bro"])],
    ]);
  });

  it("counts a payment out as finished, the money having left your hands either way", () => {
    // OFFSET takes it off their debt and PAID sends it. Both are decisions, and a sale waiting on
    // one is the only kind the pill is still asking about.
    const sales = held([sale("t1", 70, 1_000 * M, "2026-08-14")]);
    const undecided = decidedSales(sales, []);
    const sent = decidedSales(sales, [decided("15", 1_000 * M, "PAID")]);
    expect([undecided.size, [...sent.keys()]]).toEqual([0, ["t1"]]);
  });

  it("keeps saying so once their card is empty, which paying them out in full makes it", () => {
    // Read off the built cards this went backwards: the last decision takes the row off the ledger
    // entirely, and a sale nothing carries any more would come back to the Sale Ledger as pending.
    const sales = held([sale("t1", 70, 1_000 * M, "2026-08-14")]);
    const disposal = decided("15", 1_000 * M, "PAID");
    expect(
      buildSettlement([], wallet([]), [], sales, new Map(), new Map(), new Set(), new Map(), [
        disposal,
      ]),
    ).toEqual([]);
    expect([...decidedSales(sales, [disposal]).keys()]).toEqual(["t1"]);
  });

  it("names none of a decision whose sales cannot be told apart exactly", () => {
    // The pill stays on screen. A worklist that keeps a finished row is noise; one that hides an
    // unfinished row is a wrong number nobody can find again.
    const out = decidedSales(held([sale("t1", 70, 1_000 * M, "2026-08-14")]), [
      decided("15", 400 * M),
    ]);
    expect(out.size).toBe(0);
  });

  it("never queues one person's decisions against another's money", () => {
    // Two piles, one decision. Spending them in one queue would have Jared's offset land on the sale
    // of Bro's coupons and settle a debt Jared never agreed to.
    const out = decidedSales(
      new Map([
        [
          "person:p-bro",
          { toThem: 1_000 * M, toYou: 0, sales: [sale("t1", 70, 1_000 * M, "2026-08-14")] },
        ],
        [
          "person:p-jared",
          { toThem: 1_000 * M, toYou: 0, sales: [sale("t2", 70, 1_000 * M, "2026-08-15")] },
        ],
      ]),
      [{ ...decided("15", 1_000 * M), holder: JARED }],
    );
    expect([...out]).toEqual([["t2", new Set(["person:p-jared"])]]);
  });
});

describe("them keeping coupons of yours, at a price", () => {
  const tranche = (id: string, holder: Holder, shares?: { holder: Holder }[]) => ({
    id,
    holder,
    shares,
  });

  it("finds the ones entered against somebody else's pile, keyed by whose", () => {
    const out = keptOfYours([tranche("t1", BRO, [{ holder: SELF }])]);
    expect(out.get("person:p-bro")?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("leaves your own pile's rows alone, the Sale Ledger drawing those", () => {
    // Two cards offering to remove one row is two answers about one act.
    expect(keptOfYours([tranche("t1", SELF, [{ holder: BRO }])])).toEqual(new Map());
  });

  it("leaves out a row of theirs that never named you", () => {
    // Their pile selling their own coupons is their business and reaches your card nowhere.
    expect(keptOfYours([tranche("t1", BRO), tranche("t2", BRO, [{ holder: STRANGER }])])).toEqual(
      new Map(),
    );
  });

  it("takes the pieces off the count and puts the money on the card", () => {
    // The whole act: Bro keeps the 20 he is holding, at 400m. They stop being a coupon claim, and
    // 400m comes off what you owe him. Netting them instead would have decided that for him.
    const [row] = buildSettlement(
      [ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l1", "baldrix", 20)] })],
      wallet([]),
      [],
      new Map([["person:p-bro", { toThem: 0, toYou: 400 * M, sales: [] }]]),
      new Map(),
      new Map(),
      new Set(),
      new Map([[answeredKey("person:p-bro", "self"), sold(20)]]),
    );
    expect([row!.pieces, row!.piecesAnswered.yours]).toEqual([0, 20]);
    expect(row!.parts.soldOfYours).toBe(400 * M);
    expect(row!.mesos).toBe(400 * M);
  });
});

describe("closing the coupon books with one person", () => {
  /** A night of your own owing two people, which no closure can settle for one of them. */
  const owingTwo = (lootId: string, bossKey: string) => ({
    lootId,
    partyId: `pa-${lootId}`,
    bossKey,
    weekStart: "2026-08-13",
    droppedOn: "2026-08-13",
    looterName: "HuskyxKenshi",
    pieces: 180,
    closed: false,
    transfers: [
      { fromId: "self", toId: "person:p-bro", from: "you", to: "Bro", pieces: 30 },
      { fromId: "self", toId: "character:zaddy", from: "you", to: "Zaddy", pieces: 20 },
    ],
  });

  const card = (ledgers: HolderLedger[]) => buildSettlement(ledgers, wallet([]))[0]!;

  it("names both sides, since one handover finishes both", () => {
    // Husky's week with Bro: five nights of his in your inventory, one of yours in his. Settling is
    // one transfer of the difference, so it closes six bosses and not one.
    const row = card([
      ledger(SELF, "you", {
        drops: [holdingOf("l1", "malefic-star", 30), holdingOf("l2", "kaling", 20)],
      }),
      ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l3", "baldrix", 20)] }),
    ]);
    const pair = settleThePair(row);
    expect([pair.theirs, pair.yours]).toEqual([["l3"], ["l1", "l2"]]);
    expect([closes(pair), pair.shared, pair.offered]).toEqual([3, 0, true]);
  });

  it("is offered when the debt runs only one way, which is most weeks", () => {
    // The half that had no act at all: you looted every lot, so every night is in your own pile and
    // the old button, which only ever named theirs, closed nothing.
    const yoursOnly = settleThePair(
      card([ledger(SELF, "you", { drops: [holdingOf("l1", "kaling", 20)] })]),
    );
    expect([yoursOnly.theirs, yoursOnly.yours, yoursOnly.offered]).toEqual([[], ["l1"], true]);

    const theirsOnly = settleThePair(
      card([ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l2", "baldrix", 20)] })]),
    );
    expect([theirsOnly.theirs, theirsOnly.yours, theirsOnly.offered]).toEqual([["l2"], [], true]);
  });

  it("leaves out a night that owes somebody else, and says how many", () => {
    // A closure is keyed (pile, drop), so it cannot mean "settled with Bro alone". Closing this one
    // would call Zaddy's 20 settled too, on no screen and with no act. Prefer the missing item.
    const row = card([
      ledger(SELF, "you", { drops: [holdingOf("l1", "kaling", 20), owingTwo("l2", "kalos")] }),
    ]);
    const pair = settleThePair(row);
    expect(pair.yours).toEqual(["l1"]);
    expect([closes(pair), pair.shared]).toEqual([1, 1]);
  });

  it("is refused outright when every night is shared", () => {
    const pair = settleThePair(card([ledger(SELF, "you", { drops: [owingTwo("l1", "kalos")] })]));
    expect([closes(pair), pair.shared, pair.offered]).toEqual([0, 1, false]);
  });

  it("counts one night once, however many transfers of it they are owed", () => {
    // Two transfers to one person off one drop is one drop and one closure. Naming it twice would
    // have the button claim to close two nights and post a duplicate loot id.
    const twice = {
      ...holdingOf("l1", "kaling", 20),
      transfers: [
        { fromId: "self", toId: "person:p-bro", from: "you", to: "Bro", pieces: 20 },
        { fromId: "self", toId: "person:p-bro", from: "you", to: "Bro", pieces: 10 },
      ],
    };
    const pair = settleThePair(card([ledger(SELF, "you", { drops: [twice] })]));
    expect([pair.yours, closes(pair)]).toEqual([["l1"], 1]);
  });

  it("has nothing to close on a card held open by money alone", () => {
    // A pinned person, or one who owes mesos and no coupons. The act must not appear: there is no
    // night to name, and the server refuses a settlement that names none.
    const row = buildSettlement(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l1", 900 * M)])]),
    )[0]!;
    expect(settleThePair(row).offered).toBe(false);
  });

  it("leaves a closed night alone, it having been settled already", () => {
    const row = card([
      ledger(SELF, "you", {
        drops: [holdingOf("l1", "kaling", 20), holdingOf("l2", "kalos", 30, true)],
      }),
    ]);
    expect(settleThePair(row).yours).toEqual(["l1"]);
  });
});

describe("pieces a sale has already answered for", () => {
  /**
   * The night this was reported on, to the piece.
   *
   * Your pile held 150 of Bro's across five open nights, Bro held 20 of yours off a Hard Baldrix, and
   * one tranche of 70 sold out of your own pile named all 70 as his. The Sale Ledger subtracted that
   * 70 and said 60; this card did not and said 130. Same debt, two screens, two answers, the gap
   * being exactly the coupons whose money was already on the card as `soldOfTheirs`.
   */
  const theNight = () => ({
    ledgers: [
      ledger(SELF, "you", {
        drops: [
          holdingOf("l1", "malefic-star", 30),
          holdingOf("l2", "kaling", 20),
          holdingOf("l3", "chosen-seren", 10),
          holdingOf("l4", "kalos-the-guardian", 60),
          holdingOf("l5", "kalos-the-guardian", 30),
        ],
      }),
      ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l6", "baldrix", 20)] }),
    ],
    answered: new Map([[answeredKey("self", "person:p-bro"), sold(70)]]),
  });

  /** The card, with everything between the wallet and the answered map left empty. */
  const cardFor = (ledgers: HolderLedger[], answered: Map<string, AnsweredSale[]>) =>
    buildSettlement(ledgers, wallet([]), [], new Map(), new Map(), new Map(), new Set(), answered);

  it("takes them off what you owe, so both ledgers give one answer", () => {
    const { ledgers, answered } = theNight();
    const [row] = cardFor(ledgers, answered);
    // 150 owed less the 70 sold is 80, and the 20 Bro holds of yours cancels against it.
    expect([row!.piecesYouOwe, row!.pieces, row!.piecesNet]).toEqual([60, 0, 60]);
  });

  it("said 130 before, which was the 70 asked for twice", () => {
    // The regression itself, pinned. Without the answered map the card is back to counting coupons
    // whose money it is already carrying.
    const { ledgers } = theNight();
    const [row] = buildSettlement(ledgers, wallet([]));
    expect(row!.piecesNet).toBe(130);
  });

  it("says how many, on the row whose money replaced them", () => {
    // A count that changed still gets said. It goes on `soldOfTheirs`, which is the same fact in
    // mesos, rather than on a line of its own restating it.
    const { ledgers, answered } = theNight();
    const [row] = cardFor(ledgers, answered);
    expect(row!.piecesAnswered).toEqual({ yours: 0, theirs: 70 });
  });

  it("takes nothing off the OTHER direction, which this sale did not answer", () => {
    // The sale came out of your pile, so it answers what you owe. What Bro is holding of yours is a
    // separate count with its own answered figure, and spending one on the other would be the
    // cross-person netting one card away.
    //
    // Its own night rather than theNight()'s, so the pair cancelling cannot be read as the sale doing
    // it: 10 of his in your pile and all of it sold, against 20 of yours in his.
    const [row] = cardFor(
      [
        ledger(SELF, "you", { drops: [holdingOf("l1", "kaling", 10)] }),
        ledger(BRO, "Bro", { owedToYou: 20, drops: [owing("l2", "baldrix", 20)] }),
      ],
      new Map([[answeredKey("self", "person:p-bro"), sold(10)]]),
    );
    expect(row!.piecesAnswered.yours).toBe(0);
    expect(row!.drops.map((d) => d.pieces)).toEqual([20]);
  });

  it("leaves the listed nights adding up to the count above them", () => {
    // The invariant the card draws. The list used to be GROSS, on the reasoning that a tranche names
    // a person and never a boss so there is no night to take the answered pieces off; what that cost
    // is six nights and 150 coupons listed under a headline of 20. The answer comes off the nights
    // oldest first now, so the list and the count cannot disagree.
    const { ledgers, answered } = theNight();
    const [row] = cardFor(ledgers, answered);
    const listed = row!.owedDrops.reduce((sum, d) => sum + d.pieces, 0);
    expect(listed).toBe(row!.piecesYouOwe);
  });

  it("keeps an answered night in the list at zero, so closing the pair still closes it", () => {
    // The trap under the fold. A night answered in money is finished and closing its books is right,
    // so dropping it from the list would quietly take it out of settleThePair and leave it open for
    // ever. It is kept at zero and drawn in no row. See spendOldestFirst.
    const { ledgers, answered } = theNight();
    const [row] = cardFor(ledgers, answered);
    expect(row!.owedDrops.some((d) => d.pieces === 0)).toBe(true);
    expect(closes(settleThePair(row!))).toBe(6);
  });

  it("squares to nothing once every coupon has been sold or netted", () => {
    // Two sales of 70 and 60 against 150 owed, and Bro holding the last 20. The 130 is on the card in
    // mesos, the last 20 cancels against his, and both counts are zero.
    //
    // Pinned only so there is a row to read: see below for what an unpinned one does.
    const { ledgers } = theNight();
    const [row] = buildSettlement(
      ledgers,
      wallet([]),
      [],
      new Map(),
      new Map(),
      new Map(),
      new Set(["person:p-bro"]),
      new Map([[answeredKey("self", "person:p-bro"), sold(130)]]),
    );
    expect([row!.piecesYouOwe, row!.pieces, row!.piecesNet]).toEqual([0, 0, 0]);
    expect(row!.piecesAnswered.theirs).toBe(130);
    // Six nights to close still: the coupons are square, the books are not.
    expect(closes(settleThePair(row!))).toBe(6);
  });

  it("drops the card once nothing is outstanding in either unit", () => {
    // The same night unpinned. Every coupon sold or cancelled and no money on it, so it goes the way
    // every other card with nothing on it goes, and comes straight back on the next night.
    const { ledgers } = theNight();
    expect(cardFor(ledgers, new Map([[answeredKey("self", "person:p-bro"), sold(130)]]))).toEqual(
      [],
    );
  });

  it("caps at what is owed, so a mistyped tranche cannot answer for more", () => {
    // The money is on the card as well, the way it always is: pieces are only ever answered by a
    // tranche that named a price. Without it this card would not be drawn at all, and rightly, the
    // whole debt having gone.
    const [row] = buildSettlement(
      [ledger(SELF, "you", { drops: [holdingOf("l1", "kaling", 20)] })],
      wallet([]),
      [],
      new Map([["person:p-bro", { toThem: 500 * M, toYou: 0, sales: [] }]]),
      new Map(),
      new Map(),
      new Set(),
      new Map([[answeredKey("self", "person:p-bro"), sold(500)]]),
    );
    expect([row!.piecesYouOwe, row!.piecesAnswered.theirs]).toEqual([0, 20]);
  });

  it("drops the card when the pieces were the whole of it and money settled them", () => {
    const rows = cardFor(
      [ledger(SELF, "you", { drops: [holdingOf("l1", "kaling", 20)] })],
      new Map([[answeredKey("self", "person:p-bro"), sold(20)]]),
    );
    expect(rows).toEqual([]);
  });

  it("keeps one person's sold coupons off another person's card", () => {
    // The reason this is keyed by PAIR. A pile total here would take Bro's 70 off whichever card was
    // drawn next, which is the plausible wrong number rather than a missing one.
    const rows = cardFor(
      [
        ledger(SELF, "you", {
          drops: [
            holdingOf("l1", "kaling", 40),
            {
              lootId: "l2",
              partyId: "pa-l2",
              bossKey: "limbo",
              weekStart: "2026-08-13",
              droppedOn: "2026-08-13",
              looterName: "HuskyxKenshi",
              pieces: 120,
              closed: false,
              transfers: [
                { fromId: "self", toId: "character:zaddy", from: "you", to: "Zaddy", pieces: 30 },
              ],
            },
          ],
        }),
      ],
      new Map([[answeredKey("self", "person:p-bro"), sold(40)]]),
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("Zaddy")!.piecesYouOwe).toBe(30);
    expect(byName.has("Bro")).toBe(false);
  });

  it("answers the mirror direction too, where THEY sold coupons of yours", () => {
    // Their pile, their sale, and it named you. Those pieces are `soldOfYours` in mesos now, so the
    // count they came off stops asking as well.
    const [row] = cardFor(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      new Map([[answeredKey("person:p-bro", "self"), sold(50)]]),
    );
    expect([row!.pieces, row!.piecesAnswered.yours, row!.piecesNet]).toEqual([30, 50, -30]);
  });
});

describe("splitting an offset written before one-row-per-share", () => {
  const share = (lootId: string, memberId: string, amount: number): OffsetShare => ({
    key: shareKey(lootId, memberId),
    lootId,
    memberId,
    item: "Grindstone of Faith",
    currency: "MESO",
    iconUrl: null,
    boss: "Lotus",
    members: ["Bro"],
    on: "2026-08-28",
    share: amount,
    sale: null,
    partyId: "p1",
  });

  const resolved = (...shares: OffsetShare[]) => new Map(shares.map((s) => [s.key, s]));

  const entry = (id: string, amount: number, payouts: number): SettlementDebt => ({
    id,
    holder: BRO,
    amount,
    note: "offset against Bro",
    payouts: Array.from({ length: payouts }, (_, i) => ({ lootId: `l${i}`, memberId: `m${i}` })),
    incurredAt: "2026-08-29T15:14:30Z",
  });

  const THREE = resolved(
    share("l0", "m0", 1_933_333_333),
    share("l1", "m1", 372_222_222),
    share("l2", "m2", 3_296_549_809),
  );

  it("gives one part per share when they reconstruct the entry exactly", () => {
    const [split, ...rest] = splittableDebts([entry("d1", -5_602_105_364, 3)], THREE);
    expect(rest).toEqual([]);
    expect(split!.parts).toEqual([
      { lootId: "l0", memberId: "m0", amount: 1_933_333_333 },
      { lootId: "l1", memberId: "m1", amount: 372_222_222 },
      { lootId: "l2", memberId: "m2", amount: 3_296_549_809 },
    ]);
  });

  it("REFUSES when the shares no longer add up to what came off", () => {
    // A roster that moved since divides the same lot a different way. Rows summing to something
    // other than the act is the wrong number this ledger exists to prevent, and the entry it would
    // replace is the only record of the real figure.
    const off = resolved(share("l0", "m0", 1), share("l1", "m1", 2));
    expect(splittableDebts([entry("d1", -5_602_105_364, 2)], off)).toEqual([]);
  });

  it("REFUSES while a share is still unresolved", () => {
    // A deleted night, or pools that have not arrived yet. This runs on every render, so "not yet"
    // and "never" have to end the same way: a partial split writes some of the act and drops the
    // rest, and there is no second pass that would notice.
    expect(splittableDebts([entry("d1", -500, 2)], resolved(share("l0", "m0", 500)))).toEqual([]);
    expect(splittableDebts([entry("d1", -500, 2)], new Map())).toEqual([]);
  });

  it("REFUSES once another entry already names one of the shares", () => {
    // What a split looks like when its rows landed and the delete behind them did not. Splitting
    // again would write three more rows off the same act, and the figure would walk further from
    // the truth on every load. A share is discharged once or the ledger is wrong.
    const half = entry("d2", -1_933_333_333, 1);
    expect(splittableDebts([entry("d1", -5_602_105_364, 3), half], THREE)).toEqual([]);
  });

  it("is not offered on an entry that is already one share", () => {
    expect(splittableDebts([entry("d1", -500, 1)], resolved(share("l0", "m0", 500)))).toEqual([]);
  });

  it("is not offered on a debt somebody TYPED, which discharges nothing", () => {
    // Positive is theirs to pay. It names no shares, and splitting a hand-entered figure would be
    // inventing rows for an act that never covered any.
    expect(splittableDebts([entry("d1", 5_602_105_364, 3)], THREE)).toEqual([]);
  });
});

// Which sales the money you are still holding came out of. The figure arrived as a bare 2.41b and
// nothing on any screen said that was 130 coupons over two nights.
//
// The card draws the answer as rows under the figure, so the rows have to come to the figure. Where
// a decision stopped part way through a sale they cannot: "70 coupons" beside 400m of a 1.3b lot is
// a wrong number wearing an itemisation, which is the failure this repo exists to prevent.
describe("the sales behind the money you are holding", () => {
  const sale = (mesos: number, pieces = mesos / 10_000_000) => ({
    trancheId: `t-${mesos}`,
    pieces,
    mesos,
    lot: { pieces, amount: mesos },
    soldAt: "2026-08-12",
  });

  it("is every sale where nothing has been decided", () => {
    const sales = [sale(1_000_000_000), sale(2_000_000_000)];
    expect(undecidedSales({ sales, holding: 3_000_000_000 })).toEqual(sales);
  });

  it("drops the ones already decided, oldest first", () => {
    const sales = [sale(1_000_000_000), sale(2_000_000_000)];
    // A billion offset or paid out. Which sale that was is the front of the list, the order
    // buildSettlement spends the money in.
    expect(undecidedSales({ sales, holding: 2_000_000_000 })).toEqual([sales[1]]);
  });

  it("comes to exactly what is being held, whatever has come off", () => {
    const sales = [sale(1_000_000_000), sale(2_000_000_000), sale(500_000_000)];
    for (const holding of [3_500_000_000, 2_500_000_000, 500_000_000, 0]) {
      const rows = undecidedSales({ sales, holding });
      expect(rows.reduce((sum, row) => sum + row.mesos, 0)).toBe(holding);
    }
  });

  it("refuses the lot where a decision stopped mid-sale", () => {
    // 1.5b decided out of a 1b sale and a 2b one: half of the second is gone, and no whole row can
    // say so. The card says the figure and nothing about its parts, which is what it said before.
    const sales = [sale(1_000_000_000), sale(2_000_000_000)];
    expect(undecidedSales({ sales, holding: 1_500_000_000 })).toEqual([]);
  });

  it("is empty where nothing was ever credited", () => {
    expect(undecidedSales({ sales: [], holding: 0 })).toEqual([]);
  });
});
