// The queue of outstanding pieces, built from what the pools endpoint already returns.
//
// The arithmetic is piece-ledger.ts and none of it is repeated here. This file only decides WHICH
// drops are outstanding, whose pile they are in, and what each HOLDER was entitled to, so the one
// input ("sold N pieces for X") can be distributed without anybody naming a boss.
//
// A row's quantity is WHAT FELL (see V40). Who ended up holding it comes from two places, in this
// order: a recorded arrangement splits it stack by stack (V41), or the stacks divide and everybody
// took their share.
//
// A third case is deliberately NOT answered: the drop did not divide and nobody has said who took
// the odd stack. It is not rare (a duo can never divide 3 stacks) and skipping it would record no
// debt rather than an unknown one, so `unanswered()` names the size of the hole without guessing
// its direction.
//
// A HOLDER is a person, not a character. Seats are folded to their holder before anything is
// counted, so a party of your own two characters owes nothing, and one person on three characters
// has one pile rather than three.

import {
  type LedgerDrop,
  balances,
  entitlements,
  heldOf,
  ownShareOf,
  pieces as roundPieces,
  transfersOf,
} from "./piece-ledger";
import type { AnsweredSale, PieceTransfer } from "./piece-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** Whose pile it is. Mirrors the three kinds V39 stores, and is what a tranche is filed under. */
export type Holder = {
  kind: "PERSON" | "SELF" | "CHARACTER";
  personId: string | null;
  /** Lowercased. Only a CHARACTER holder has one: nobody has said who plays them yet. */
  characterName: string | null;
};

/** One boss's outstanding pieces, ready for the queue, with who is holding them. */
export type OutstandingDrop = {
  drop: LedgerDrop;
  lootId: string;
  partyId: string;
  bossKey: string | null;
  /**
   * The day it fell, which is the order a debt is answered in. See queueOf.
   *
   * Not derivable from `weekStart`: a sale cannot have come off a night that fell after it, and the
   * week alone cannot tell two nights apart.
   */
  droppedOn: string;
  /** When it was LOGGED, which is what says a sale could have answered it. See spendSales. */
  recordedAt?: string;
  /** Whose pile the pieces are in. The tranche tally is theirs, so the queue is split by it. */
  holder: Holder;
  /** What to call them on screen. */
  holderName: string;
  /** The character that actually looted it. Shown on the row, never what anything is keyed by. */
  looterName: string;
  /** Every character who ran that night, as the party named them. */
  ran: string[];
};

/**
 * One holder's pile: their queue, and what each boss in it owes once its pieces are covered.
 *
 * Every total here counts the drops that are still OPEN. A closed drop keeps its entry in `drops`,
 * because that is where a mistyped tranche is corrected, but it is finished: adding it back into
 * these figures asks again for pieces and mesos that were settled. `drops` is the only field that
 * carries the closed ones, and each says so.
 */
export type HolderLedger = {
  holder: Holder;
  holderName: string;
  /** Pieces they are holding across every boss still open. */
  pieces: number;
  /** Of those, how many are YOURS. Zero on your own card, where the debts run the other way. */
  owedToYou: number;
  /**
   * Mesos that have arrived from them. See V51.
   *
   * The only money on this type: a piece debt has no derivable price (coupons are single-trade and
   * the two sides come off different nights), so pieces stay a count.
   */
  received: number;
  /**
   * Pieces of the pile they are redeeming rather than selling, as entered.
   *
   * More than `pieces` is a miscount, carried raw so it can be said rather than clamped.
   */
  kept: number;
  /**
   * Pieces of the pile that are their OWN, which bounds what they can redeem. Pieces of yours they
   * take anyway are a purchase. See V50.
   */
  ownShare: number;
  /** Pieces of yours they bought outright, and what they agreed to pay. See V50. */
  bought: { pieces: number; paid: number };
  /** Pieces entered as sold, whatever the queue has managed to spend them on. */
  soldPieces: number;
  /** Pieces of this pile answered with money rather than with coupons. See V56 and answeredByHolder. */
  answered: number;
  /**
   * The same pieces, split by WHO they answered. See answeredByPair.
   *
   * Only this can retire a night: spending one person's sold coupons on a night owed to another is
   * the cross-person netting `owes` refuses. One entry per SALE, because the spend needs each sale's
   * day. See spendSales.
   */
  answeredByCreditor: Map<string, AnsweredSale[]>;
  /**
   * Every drop under this holder has had its books closed. See V52.
   *
   * Not derivable from the money: a drop is queued on `entitled - looted`, fixed when it was logged,
   * so no sale or payment can retire it. Somebody decides.
   */
  closed: boolean;
  /** Mesos written off across the acts that closed this pile. */
  writtenOff: number;
  /**
   * Pieces of the pile whose fate has been entered: sold, kept, or taken. The gap to `pieces` is what
   * is still unanswered; above `pieces` is a miscount, carried raw rather than clamped.
   */
  accounted: number;
  drops: {
    lootId: string;
    partyId: string;
    bossKey: string | null;
    weekStart: string;
    /** The day it fell, which orders how a debt is answered. */
    droppedOn: string;
    /** When it was LOGGED, which is what says a sale could have answered it. See spendSales. */
    recordedAt?: string;
    /** Which of this holder's characters looted it. */
    looterName: string;
    /** Every character who ran that night. */
    ran: string[];
    pieces: number;
    /** Its books are closed. See V52. */
    closed: boolean;
    transfers: PieceTransfer[];
  }[];
};

/**
 * Who a seat belongs to.
 *
 * Your own characters are not on the people list, so a `characterId` seat is you (SELF), not an
 * unattributed CHARACTER.
 */
export function holderOf(seat: PartyMember): Holder {
  if (seat.personId !== null)
    return { kind: "PERSON", personId: seat.personId, characterName: null };
  if (seat.characterId !== null) return { kind: "SELF", personId: null, characterName: null };
  return { kind: "CHARACTER", personId: null, characterName: seat.name.trim().toLowerCase() };
}

/** You, as a holder key. */
export const SELF_KEY = "self";

/** You, as a holder. */
export const SELF_HOLDER: Holder = { kind: "SELF", personId: null, characterName: null };

/** How a holder is matched, on either side of the wire. */
export function holderKey(holder: Holder): string {
  if (holder.kind === "PERSON") return `person:${holder.personId}`;
  if (holder.kind === "SELF") return SELF_KEY;
  return `character:${holder.characterName}`;
}

/** holderKey() read back. A piece transfer names its creditor by key alone. */
export function holderFromKey(key: string): Holder {
  if (key === SELF_KEY) return { kind: "SELF", personId: null, characterName: null };
  if (key.startsWith("person:")) {
    return { kind: "PERSON", personId: key.slice("person:".length), characterName: null };
  }
  return { kind: "CHARACTER", personId: null, characterName: key.slice("character:".length) };
}

/** One person your pile owes coupons to: who they are, and how many of theirs you are holding. */
export type PieceCreditor = { key: string; holder: Holder; name: string; pieces: number };

/**
 * Who a pile owes pieces to, across the drops it still has open.
 *
 * Only OPEN drops: a closed one was settled, and crediting out of it would pay a debt twice.
 * Biggest debt first.
 */
export function pieceCreditors(ledger: HolderLedger): PieceCreditor[] {
  const out = new Map<string, PieceCreditor>();
  for (const drop of ledger.drops) {
    if (drop.closed) continue;
    for (const transfer of drop.transfers) {
      const seen = out.get(transfer.toId);
      if (seen) seen.pieces += transfer.pieces;
      else {
        out.set(transfer.toId, {
          key: transfer.toId,
          holder: holderFromKey(transfer.toId),
          name: transfer.to,
          pieces: transfer.pieces,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.pieces - a.pieces || a.name.localeCompare(b.name));
}

/** What to call a holder. Your own seats are "you". */
export function holderName(seat: PartyMember): string {
  if (seat.personId !== null) return seat.personName ?? seat.name;
  if (seat.characterId !== null) return "you";
  return seat.name;
}

/** One holder in a party: who they are, and how many shares their seats add up to. */
export type FoldedSeat = { key: string; holder: Holder; name: string; shares: number };

/**
 * A party's seats folded to the people behind them.
 *
 * The one place seats become people. Two characters of one person are one holder with two shares.
 */
export function foldSeats(seats: PartyMember[]): FoldedSeat[] {
  const folded = new Map<string, FoldedSeat>();
  for (const seat of seats) {
    const holder = holderOf(seat);
    const key = holderKey(holder);
    const seen = folded.get(key);
    if (seen) seen.shares += seat.shares;
    else folded.set(key, { key, holder, name: holderName(seat), shares: seat.shares });
  }
  return [...folded.values()];
}

/**
 * How many of a piece drop are YOURS, out of what fell.
 *
 * Derived on every read and stored nowhere: who ran and how shares fall are edited long after a drop
 * is filed, and a stored share would not follow them. See V40. Zero when none of the seats are yours.
 */
export function yourShare(whole: number, seats: PartyMember[]): number {
  const folded = foldSeats(seats);
  const entitled = entitlements(
    whole,
    folded.map((f) => ({ memberId: f.key, name: f.name, looted: 0, shares: f.shares })),
  );
  return entitled.get(SELF_KEY) ?? 0;
}

/**
 * Whether stacks can be shared out so every holder ends on exactly their entitlement.
 *
 * A holder is entitled to `bundles * shares / weight` stacks, and a stack is whole, so a drop
 * divides by looting alone only when that is a whole number for every one of them.
 *
 * Measured on FOLDED holders, never on seats: three stacks between three characters, two of them one
 * person's, divides perfectly.
 */
export function dividesEvenly(bundles: number, holders: FoldedSeat[]): boolean {
  const weight = holders.reduce((sum, h) => sum + h.shares, 0);
  if (weight <= 0) return false;
  return holders.every((h) => (bundles * h.shares) % weight === 0);
}

/**
 * The seats that ran the week THIS drop fell in.
 *
 * `party.members` is whichever week the page asked for, and a pool spans months: measuring a drop
 * against another week's roster owes a share to somebody who was not there.
 *
 * Falls back to `party.members` when the week names nobody (every seat retired). An empty roster
 * would say none of the drop is yours.
 */
export function ranSeats(loot: Loot, party: Party): PartyMember[] {
  const ran = party.seats.filter((seat) => loot.ranThatWeek.includes(seat.id));
  // The share in force THAT WEEK (frozen by pinWeeksAlreadyWritten), so a deal agreed today does not
  // re-divide a past drop. Absent means the standing share. See V55.
  const shares = loot.sharesThatWeek ?? {};
  return (ran.length > 0 ? ran : party.members).map((seat) =>
    seat.id in shares ? { ...seat, shares: shares[seat.id]! } : seat,
  );
}

/** Those seats folded to the people behind them. Empty when there is nothing to divide. */
function holdersOf(loot: Loot, party: Party): FoldedSeat[] {
  const ran = ranSeats(loot, party);
  if (ran.length < 2) return [];
  return foldSeats(ran);
}

/**
 * What each holder walked away with, or null when nobody has said and it matters.
 *
 * Two ways a night can be known, and one way it cannot, in this order:
 *
 *  - a recorded arrangement, stack by stack, folded to holders.
 *  - none, but the stacks divide, so everybody took exactly their share.
 *
 * Otherwise null. The drop did not divide, nobody has said who took the odd stack, and there is no
 * honest default: a guess is right half the time and names the wrong person the rest.
 *
 * A party's standing looter is not a third way: it was retired in V78.
 */
function heldByHolder(loot: Loot, party: Party, holders: FoldedSeat[]): Map<string, Pile> | null {
  const held = pilesFrom(loot, party, holders);
  if (held === null) return null;
  // Everybody who ran, including the empty-handed. Without them the ordinary night (one person loots
  // the whole drop) has nobody on the other side, and the debt goes unsaid.
  for (const holder of holders) {
    if (!held.has(holder.key)) held.set(holder.key, { pieces: 0, by: holder.name });
  }
  return held;
}

/** The arrangement itself, before the empty-handed are put back in. See heldByHolder. */
function pilesFrom(loot: Loot, party: Party, holders: FoldedSeat[]): Map<string, Pile> | null {
  const bundles = bundlesOf(loot);
  const bundlesBy = loot.bundlesBy ?? [];

  if (bundlesBy.length > 0 && bundles !== null && bundles > 0) {
    // Stacks are equal, so a seat's pieces are its stacks times the stack size. Whole by
    // construction: the seed refuses a total that does not divide by its bundle count.
    const size = loot.quantity / bundles;
    const seat = new Map(party.seats.map((s) => [s.id, s]));
    const held = new Map<string, Pile>();
    for (const row of bundlesBy) {
      const picked = seat.get(row.memberId);
      if (!picked) return null;
      const key = holderKey(holderOf(picked));
      const seen = held.get(key);
      if (seen) {
        seen.pieces += row.bundles * size;
        // One person can loot on two characters. Both are named: which holds the coupons matters.
        if (!seen.by.includes(picked.name)) seen.by = `${seen.by}, ${picked.name}`;
      } else {
        held.set(key, { pieces: row.bundles * size, by: picked.name });
      }
    }
    return held;
  }

  if (bundles !== null && dividesEvenly(bundles, holders)) {
    const weight = holders.reduce((sum, h) => sum + h.shares, 0);
    return new Map(
      holders.map((h) => [h.key, { pieces: (loot.quantity * h.shares) / weight, by: h.name }]),
    );
  }
  return null;
}

/** One holder's pieces from one drop, and which of their characters bent down for them. */
type Pile = { pieces: number; by: string };

/** One night's coupons that ended up in the wrong hands, and whose they are. */
export type CouponGap = {
  /** How many are out of place. Always positive: an even night has no gap at all. */
  pieces: number;
  /** True when YOU are the one holding them, so they are yours to hand over. */
  yours: boolean;
  /** The other side of it: who is holding yours, or who you are holding for. */
  by: string;
  /** The holder key of whoever is holding the surplus, which is whose books close it. See V52. */
  holder: string;
  /**
   * `by` as a key, which is the CREDITOR when the coupons are yours to hand over. Matching is by key
   * because a name can list two characters or be spelled however the seat spells it.
   */
  byKey: string;
};

/**
 * One night's coupon debt, in whichever direction it runs.
 *
 * The GAP, never a whole share: four stacks of six when entitled to three owes you nothing and leaves
 * you holding one stack of theirs. Reporting your full share instead gives the wrong figure pointing
 * the wrong way.
 *
 * Null where heldByHolder is null (that night is listed by unanswered() instead), and on a pool with
 * one seat.
 */
export function couponGapOf(loot: Loot, party: Party): CouponGap | null {
  const ran = ranSeats(loot, party);
  if (ran.length < 2) return null;
  const holders = foldSeats(ran);
  const held = heldByHolder(loot, party, holders);
  if (held === null) return null;
  const mine = held.get(SELF_KEY)?.pieces ?? 0;
  const short = roundPieces(yourShare(loot.quantity, ran) - mine);
  if (short === 0) return null;
  // The other side is whoever is furthest from their own share, in the opposite direction to yours.
  // Ranked against entitlement, not pile size: on a trio the biggest pile may have been earned.
  const entitled = entitlements(
    loot.quantity,
    holders.map((h) => ({ memberId: h.key, name: h.name, looted: 0, shares: h.shares })),
  );
  const others = holders
    .filter((h) => h.key !== SELF_KEY)
    .map((h) => ({ h, off: (held.get(h.key)?.pieces ?? 0) - (entitled.get(h.key) ?? 0) }))
    .sort((a, b) => (short > 0 ? b.off - a.off : a.off - b.off));
  const them = others[0];
  if (!them) return null;
  const by = held.get(them.h.key)?.by ?? them.h.name;
  return short > 0
    ? { pieces: short, yours: false, by, byKey: them.h.key, holder: them.h.key }
    : { pieces: -short, yours: true, by, byKey: them.h.key, holder: SELF_KEY };
}

/**
 * How many stacks a drop fell in, with absent reading as null.
 *
 * A tab cached across a deploy (lib/cache.ts) can hand over a row without the field, and
 * `undefined !== null` would let the arithmetic run to NaN.
 */
function bundlesOf(loot: Loot): number | null {
  return loot.bundles ?? null;
}

/** A drop nobody can be paid for yet, because who took the odd stack has not been said. */
export type UnansweredDrop = {
  lootId: string;
  partyId: string;
  bossKey: string | null;
  weekStart: string;
  quantity: number;
  /** How many whole stacks it fell in. */
  bundles: number;
  /** The seats that ran that week (not the page's week), which is who a stack may be handed to. */
  seats: PartyMember[];
  /**
   * Pieces that cannot be where they belong, whoever picked up what. Known exactly even though the
   * direction is not: it follows from the stacks and the shares alone.
   */
  imbalance: number;
};

/**
 * Drops that did not divide and that nobody has answered for.
 *
 * These owe somebody, and until the arrangement is recorded there is no saying who. Listed so the
 * missing debt is visible rather than silently absent.
 */
export function unanswered(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
): UnansweredDrop[] {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const out: UnansweredDrop[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      const bundles = bundlesOf(loot);
      if (loot.dropKey !== dropKey || loot.quantity < 1 || bundles === null) continue;
      // Per drop, not per pool: the roster can change between nights.
      const holders = holdersOf(loot, party);
      if (holders.length < 2) continue;
      const weight = holders.reduce((sum, h) => sum + h.shares, 0);
      if (heldByHolder(loot, party, holders) !== null) continue;

      // What the closest-to-even arrangement still leaves misplaced. Halved because every piece
      // over somebody's share is the same piece under somebody else's, counted once from each end.
      const size = loot.quantity / bundles;
      const drift = holders.reduce((sum, h) => {
        const entitled = (loot.quantity * h.shares) / weight;
        return sum + Math.abs(Math.round(entitled / size) * size - entitled);
      }, 0);

      out.push({
        lootId: loot.id,
        partyId: pool.partyId,
        bossKey: loot.bossKey,
        weekStart: loot.weekStart,
        quantity: loot.quantity,
        bundles,
        seats: ranSeats(loot, party),
        imbalance: Math.round(drift / 2),
      });
    }
  }
  return out;
}

/**
 * How far ahead or behind each holder is across every drop already answered for.
 *
 * Positive is owed pieces, negative is holding somebody else's. It moves when an earlier week is
 * edited, so it may only SUGGEST an arrangement, never be stored as one.
 */
export function runningBalance(drops: OutstandingDrop[]): Map<string, number> {
  const out = new Map<string, number>();
  // One drop has a row per pile, and every row carries the same whole-drop seat list, so counting
  // each row's balances would count the drop once per pile it sits in.
  const seen = new Set<string>();
  for (const d of drops) {
    if (seen.has(d.lootId)) continue;
    seen.add(d.lootId);
    for (const b of balances(d.drop.total, d.drop.seats)) {
      out.set(b.memberId, (out.get(b.memberId) ?? 0) + b.balance);
    }
  }
  return out;
}

/**
 * The arrangement to put in front of somebody, before they say what actually happened.
 *
 * Balanced, because that is the one that moves the least: entitlement is `bundles * shares /
 * weight` stacks, everyone takes the floor, and the odd stacks go to the biggest fractions. Any
 * more concentrated arrangement crosses more value, and every piece that crosses pays the fee
 * twice.
 *
 * The odd stack goes to whoever is furthest BEHIND, so debts alternate instead of piling up one way.
 * A party that wants a fixed split says so with its SHARES. Nothing is written until confirmed.
 */
export function suggestArrangement(
  bundles: number,
  seats: PartyMember[],
  behind: Map<string, number>,
): Map<string, number> {
  const weight = seats.reduce((sum, s) => sum + s.shares, 0);
  if (seats.length === 0 || weight <= 0 || bundles <= 0) return new Map();

  const exact = seats.map((s) => (bundles * s.shares) / weight);
  const share = exact.map(Math.floor);
  let left = bundles - share.reduce((sum, n) => sum + n, 0);

  const order = seats
    .map((s, i) => ({
      i,
      fraction: (exact[i] ?? 0) - (share[i] ?? 0),
      // Their HOLDER's position, not the seat's: two characters of one person are one pile.
      owed: behind.get(holderKey(holderOf(s))) ?? 0,
    }))
    .sort((a, b) => b.fraction - a.fraction || b.owed - a.owed || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    share[i] = (share[i] ?? 0) + 1;
    left -= 1;
  }
  // A seat with no stacks is left out rather than given a zero, which the server refuses.
  const out = new Map<string, number>();
  seats.forEach((s, i) => {
    if ((share[i] ?? 0) > 0) out.set(s.id, share[i]!);
  });
  return out;
}

/**
 * Every drop that still owes somebody, oldest first.
 *
 * One row per HOLDER holding pieces of a drop, not one per drop: a drop looted stack by stack sits in
 * several piles at once, each draining its own owner's tranches.
 *
 * A drop is left out when every pile matches its owner's share. An undivided night with no
 * arrangement is `unanswered()`'s, not this.
 *
 * `bossOrder` breaks ties inside a week, and should be the catalog's own order so the queue never
 * depends on which row was read first. A boss missing from it sorts last rather than throwing.
 */
export function outstanding(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
  bossOrder: Map<string, number>,
): OutstandingDrop[] {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const out: OutstandingDrop[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      if (loot.dropKey !== dropKey || loot.quantity < 1) continue;
      // Who ran THAT WEEK, folded to holders. A night that folds to one holder owes nobody.
      const holders = holdersOf(loot, party);
      if (holders.length < 2) continue;
      const byKey = new Map(holders.map((h) => [h.key, h]));
      const held = heldByHolder(loot, party, holders);
      if (held === null) continue;

      const seats = holders.map((h) => ({
        memberId: h.key,
        name: h.name,
        looted: held.get(h.key)?.pieces ?? 0,
        shares: h.shares,
      }));
      if (balances(loot.quantity, seats).every((b) => b.balance === 0)) continue;

      for (const [key, pile] of held) {
        const holder = byKey.get(key);
        if (!holder || pile.pieces <= 0) continue;
        out.push({
          lootId: loot.id,
          partyId: pool.partyId,
          bossKey: loot.bossKey,
          droppedOn: loot.droppedOn,
          recordedAt: loot.recordedAt,
          holder: holder.holder,
          holderName: holder.name,
          looterName: pile.by,
          ran: ranSeats(loot, party).map((s) => s.name),
          drop: {
            id: loot.id,
            weekStart: loot.weekStart,
            order: bossOrder.get(loot.bossKey ?? "") ?? Number.MAX_SAFE_INTEGER,
            total: loot.quantity,
            held: pile.pieces,
            seats,
          },
        });
      }
    }
  }
  return out;
}

/**
 * The coupons of yours that `outstanding()` leaves out, as pile rows of your own.
 *
 * That one queues DEBTS, so it drops nights everybody landed square on and bosses you ran alone.
 * Those coupons still sell, and without these rows the Sale Ledger undercounts what you hold. Only
 * YOUR piles, because a pile you cannot sell from needs no row.
 *
 * Kept apart from `outstanding`: the wallet and the party list read that one for what is OWED, and
 * widening it would put a row with no debt into both.
 */
export function alsoHeldByYou(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
  bossOrder: Map<string, number>,
  queued: OutstandingDrop[],
): OutstandingDrop[] {
  const already = new Set(
    queued.filter((d) => holderKey(d.holder) === SELF_KEY).map((d) => d.lootId),
  );
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const out: OutstandingDrop[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      if (loot.dropKey !== dropKey || loot.quantity < 1) continue;
      if (already.has(loot.id)) continue;

      const ran = ranSeats(loot, party);
      const holders = foldSeats(ran);
      const mine = holders.find((h) => h.key === SELF_KEY);
      if (!mine) continue;

      // A solo night: every piece is yours. `heldByHolder` cannot answer it, since `holdersOf`
      // refuses a night of fewer than two holders.
      const held =
        holders.length === 1
          ? new Map([[SELF_KEY, { pieces: loot.quantity, by: ran[0]?.name ?? mine.name }]])
          : heldByHolder(loot, party, holders);
      if (held === null) continue;
      const pile = held.get(SELF_KEY);
      if (!pile || pile.pieces <= 0) continue;

      out.push({
        lootId: loot.id,
        partyId: pool.partyId,
        bossKey: loot.bossKey,
        droppedOn: loot.droppedOn,
        recordedAt: loot.recordedAt,
        holder: mine.holder,
        holderName: mine.name,
        looterName: pile.by,
        ran: ran.map((s) => s.name),
        drop: {
          id: loot.id,
          weekStart: loot.weekStart,
          order: bossOrder.get(loot.bossKey ?? "") ?? Number.MAX_SAFE_INTEGER,
          total: loot.quantity,
          held: pile.pieces,
          seats: holders.map((h) => ({
            memberId: h.key,
            name: h.name,
            looted: held.get(h.key)?.pieces ?? 0,
            shares: h.shares,
          })),
        },
      });
    }
  }
  return out;
}

/**
 * One card per holder: their pile, their queue, and what each boss owes.
 *
 * One person's characters share a queue: coupons cannot move between their inventories, but mesos
 * are fungible and the ledger settles what that person owes. The looting character stays on the row.
 */
export function holderLedgers(
  drops: OutstandingDrop[],
  /** Pieces each holder has sold. A count: no debt is priced off a sale. */
  salesByHolder: Map<string, number>,
  /** Pieces each holder is redeeming rather than selling. Absent is none. See V46. */
  keptByHolder: Map<string, number> = new Map(),
  /** Pieces of yours each holder bought outright, and what they agreed to pay. See V50. */
  boughtByHolder: Map<string, { pieces: number; paid: number }> = new Map(),
  /** Mesos that have actually arrived from each holder. See V51. */
  receivedByHolder: Map<string, number> = new Map(),
  /**
   * Which (holder, drop) pairs have had their books closed, and what was written off. See V52.
   *
   * A closed drop keeps its row but counts towards none of the ledger's totals, which are what is
   * still owed.
   */
  closures: { closed: Set<string>; writtenOff: Map<string, number> } = {
    closed: new Set(),
    writtenOff: new Map(),
  },
  /** Pieces each pile has answered for with money rather than coupons. Absent is none. See V56. */
  answeredByHolder: Map<string, number> = new Map(),
  /**
   * The same pieces per (pile, creditor), a sale at a time, which is what retires a night. See
   * answeredSalesByPair. Absent retires nothing.
   */
  answeredByPair: Map<string, AnsweredSale[]> = new Map(),
): HolderLedger[] {
  const byHolder = new Map<string, OutstandingDrop[]>();
  for (const d of drops) {
    const seen = byHolder.get(holderKey(d.holder));
    if (seen) seen.push(d);
    else byHolder.set(holderKey(d.holder), [d]);
  }

  const ledgers: HolderLedger[] = [];
  for (const [key, mine] of byHolder) {
    const kept = keptByHolder.get(key) ?? 0;
    const bought = boughtByHolder.get(key) ?? { pieces: 0, paid: 0 };
    const soldPieces = salesByHolder.get(key) ?? 0;

    // Oldest boss first, so the rows read in the order the nights happened.
    const ordered = [...mine].sort(
      (a, b) =>
        a.drop.weekStart.localeCompare(b.drop.weekStart) ||
        a.drop.order - b.drop.order ||
        a.drop.id.localeCompare(b.drop.id),
    );
    const drops = ordered.map((d) => ({
      lootId: d.lootId,
      partyId: d.partyId,
      bossKey: d.bossKey,
      weekStart: d.drop.weekStart,
      droppedOn: d.droppedOn,
      recordedAt: d.recordedAt,
      looterName: d.looterName,
      ran: d.ran,
      // What is in THIS pile. The whole drop would count somebody else's stacks as theirs.
      pieces: heldOf(d.drop),
      closed: closures.closed.has(closureKey(d.holder, d.lootId)),
      // Only what THIS holder owes, or a split drop counts its debts once per pile.
      transfers: transfersOf(d.drop, key),
    }));

    // Pieces of YOURS they are sitting on, from open drops only: a closed one was settled.
    const owedToYou = drops
      .filter((d) => !d.closed)
      .flatMap((d) => d.transfers)
      .filter((t) => t.toId === SELF_KEY)
      .reduce((sum, t) => sum + t.pieces, 0);

    ledgers.push({
      holder: mine[0]!.holder,
      holderName: mine[0]!.holderName,
      // Every drop, closed ones included, as `accounted` is: the two are compared, and dropping
      // closed drops from one side alone would reopen the gap whenever a boss closed.
      pieces: drops.reduce((sum, d) => sum + d.pieces, 0),
      owedToYou,
      received: receivedByHolder.get(key) ?? 0,
      kept,
      ownShare: mine.reduce((sum, d) => sum + ownShareOf(d.drop, key), 0),
      bought,
      soldPieces,
      // Not in `accounted`: these pieces are already in its sold or taken counts.
      answered: answeredByHolder.get(key) ?? 0,
      // Only the creditors this pile's own nights name, so a tranche naming somebody no night owes
      // sits in the total above and retires nothing.
      answeredByCreditor: new Map(
        [...new Set(drops.flatMap((d) => d.transfers.map((t) => t.toId)))].map((creditor) => [
          creditor,
          answeredByPair.get(answeredKey(key, creditor)) ?? [],
        ]),
      ),
      accounted: soldPieces + kept + bought.pieces,
      // A pile with no drops cannot be closed: nothing was decided.
      closed: drops.length > 0 && drops.every((d) => d.closed),
      writtenOff: closures.writtenOff.get(key) ?? 0,
      drops,
    });
  }
  // Closed piles last, but still listed: their rows are corrected from their card and nowhere else.
  return ledgers.sort(
    (a, b) => Number(a.closed) - Number(b.closed) || a.holderName.localeCompare(b.holderName),
  );
}

/** One tranche as these functions read it. `disposition` absent is a row cached from before V50. */
type TrancheRow = {
  holder: Holder;
  pieces: number;
  amount: number | null;
  disposition?: string;
  /** Whose pieces the sale was. Absent is a row cached from before V56, which is all its own. */
  shares?: { holder: Holder; pieces: number }[];
  /** When it was recorded. Optional for the same reason `shares` is: see lib/cache.ts. */
  soldAt?: string;
};

/**
 * Whether a row is a purchase of the creditor's pieces rather than a sale. See V50.
 *
 * Read POSITIVELY: absent means a row cached from before BOUGHT existed (lib/cache.ts), so it is never
 * one. Testing `!== "SOLD"` would drop every sale on such a row.
 */
function isBought(row: TrancheRow): boolean {
  return row.disposition === "BOUGHT";
}

/**
 * How many pieces each holder has SOLD, keyed the way holderLedgers wants them.
 *
 * Rows with money in them, minus the purchases. KEPT and BOUGHT rows are counted by their own
 * functions below. A count, not prices: no per-piece figure is derived from a tranche's amount.
 *
 * The AMOUNT separates a sale from a redemption (V50 keeps this equivalent by check constraint).
 */
export function salesByHolder(rows: TrancheRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === null || isBought(row)) continue;
    const key = holderKey(row.holder);
    out.set(key, (out.get(key) ?? 0) + row.pieces);
  }
  return out;
}

/**
 * How many pieces each holder is redeeming rather than selling.
 *
 * Rows with no money. V46 makes amount and disposition equivalent, and `disposition` can be absent
 * on a cached response.
 */
export function keptByHolder(rows: TrancheRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.amount !== null) continue;
    const key = holderKey(row.holder);
    out.set(key, (out.get(key) ?? 0) + row.pieces);
  }
  return out;
}

/**
 * Pieces of the creditor's that each holder bought, and what they paid for them. See V50.
 *
 * One count and one total per holder, so several purchases at different prices blend.
 */
export function boughtByHolder(rows: TrancheRow[]): Map<string, { pieces: number; paid: number }> {
  const out = new Map<string, { pieces: number; paid: number }>();
  for (const row of rows) {
    if (!isBought(row) || row.amount === null) continue;
    const key = holderKey(row.holder);
    const seen = out.get(key);
    if (seen) {
      seen.pieces += row.pieces;
      seen.paid += row.amount;
    } else out.set(key, { pieces: row.pieces, paid: row.amount });
  }
  return out;
}

/**
 * Pieces of each pile that have been answered with money rather than with coupons. See V56.
 *
 * Pieces, not mesos (see saleCredits for the money). The whole rule lives here, not split with
 * settledOf, so no piece is counted twice. Two ways in:
 *
 *  - pieces a priced tranche NAMED as somebody else's, sale or purchase alike.
 *  - pieces on a purchase that named nobody. A purchase is one creditor's in full by definition
 *    (V50), so its count stands on its own.
 */
export function answeredByHolder(rows: TrancheRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === null) continue;
    const key = holderKey(row.holder);
    const named = (row.shares ?? [])
      .filter((s) => holderKey(s.holder) !== key)
      .reduce((sum, s) => sum + s.pieces, 0);
    // Capped at the tranche (the server enforces it too) against an older cached row.
    const answered = named > 0 ? Math.min(named, row.pieces) : isBought(row) ? row.pieces : 0;
    if (answered > 0) out.set(key, (out.get(key) ?? 0) + answered);
  }
  return out;
}

/** How one pile's answer to one creditor is keyed. */
export function answeredKey(pile: string, creditor: string): string {
  return `${pile}|${creditor}`;
}

/**
 * The same pieces, per (pile, creditor) instead of per pile. See V56.
 *
 * The Settlement Ledger owes each person separately, and subtracting a pile total there would take
 * one person's sold coupons off whichever card was being drawn.
 *
 * Only rows that NAMED a creditor. A purchase naming nobody stays in answeredByHolder's total and is
 * attributed to nobody here: guessing would discharge a debt against somebody who never agreed.
 *
 * Capped against the tranche in share order, as answeredByHolder caps the total.
 */
export function answeredByPair(rows: TrancheRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, sales] of answeredSalesByPair(rows)) {
    out.set(
      key,
      sales.reduce((sum, sale) => sum + sale.pieces, 0),
    );
  }
  return out;
}

/**
 * The same attribution, one entry per SALE rather than summed, so each carries the day it was made.
 *
 * A sale only answers nights already on the books when it was recorded, which a sum cannot tell.
 * See spendSales. A row with no soldAt (cached from before the field) sorts first and reaches every
 * night.
 */
export function answeredSalesByPair(rows: TrancheRow[]): Map<string, AnsweredSale[]> {
  const out = new Map<string, AnsweredSale[]>();
  for (const row of rows) {
    if (row.amount === null) continue;
    const pile = holderKey(row.holder);
    let left = row.pieces;
    for (const share of row.shares ?? []) {
      const creditor = holderKey(share.holder);
      // A share naming the pile's own holder answers nothing and spends none of the budget.
      if (creditor === pile) continue;
      if (left <= 0) break;
      const pieces = Math.min(share.pieces, left);
      left -= pieces;
      const key = answeredKey(pile, creditor);
      const sales = out.get(key) ?? [];
      sales.push({ pieces, recordedAt: row.soldAt ?? "" });
      out.set(key, sales);
    }
  }
  return out;
}

/**
 * One priced tranche, as far as it concerns ONE counterparty. See saleCredits.
 *
 * Their pieces and their share of the price, never the whole lot.
 */
export type CouponSale = {
  /** The tranche it came off, so a decision about the money can be matched back. See decidedSales. */
  trancheId: string;
  pieces: number;
  /** Their share of what the lot fetched. saleCredits' own figure, so the two cannot disagree. */
  mesos: number;
  /** The lot it came out of, so the share can be checked against it rather than taken on trust. */
  lot: { pieces: number; amount: number };
  /** The day it was recorded. Null on a row cached from before the field was read. */
  soldAt: string | null;
};

/** What one priced tranche of somebody else's pieces came to, in each direction. Mesos only. */
export type SaleCredit = {
  /** Money of THEIRS you are holding, from selling or taking pieces of theirs out of your own pile. */
  toThem: number;
  /** Money of YOURS they are holding, from a sale of yours entered against their pile. */
  toYou: number;
  /**
   * What they owe for coupons of yours they KEPT, at the price you entered (BOUGHT on their pile).
   * Netted: the price is the decision. A sale is not, see `toYou`.
   */
  keptByThem?: number;
  /**
   * The tranches behind `toThem`, oldest first. A decision names no tranche, so they are matched off
   * in this order. See moneyRows.
   */
  sales: CouponSale[];
  /** The same for `toYou`, which waits on a decision too. See V91. */
  salesToYou?: CouponSale[];
};

/**
 * What each counterparty is owed, or owes, out of priced tranches of somebody else's pieces. See V56.
 *
 * The one place a piece debt gets a price, and only from a tranche whose price the enterer TYPED: it
 * divides one lot at one price between the people whose coupons were in it. Never spread a holder's
 * proceeds over a queue of bosses (that pro rata was deleted in #354).
 *
 * A PURCHASE counts, at the price it names, or the pieces leave the pile with their money stated
 * nowhere.
 *
 * Rounded to the meso, with the remainder on the seller's side, so the two add up to the tranche.
 *
 * A row where neither side is you is left out (buildWallet's `betweenOthers`).
 */
export function saleCredits(rows: (TrancheRow & { id: string })[]): Map<string, SaleCredit> {
  const out = new Map<string, SaleCredit>();
  const add = (key: string, side: "toThem" | "toYou", mesos: number) => {
    const seen = out.get(key) ?? { toThem: 0, toYou: 0, sales: [] };
    seen[side] += mesos;
    out.set(key, seen);
    return seen;
  };

  for (const row of rows) {
    // A redemption realized nothing, so there is no price to divide. See V50.
    if (row.amount === null || row.pieces < 1) continue;
    const pile = holderKey(row.holder);
    for (const share of row.shares ?? []) {
      const creditor = holderKey(share.holder);
      if (pile !== SELF_KEY && creditor !== SELF_KEY) continue;
      const mesos = Math.round((share.pieces * row.amount) / row.pieces);
      // Itemised in the same pass it is totalled, so the rounding cannot make the two disagree.
      const sale = {
        trancheId: row.id,
        pieces: share.pieces,
        mesos,
        lot: { pieces: row.pieces, amount: row.amount },
        soldAt: row.soldAt ?? null,
      };
      if (pile === SELF_KEY) {
        add(creditor, "toThem", mesos).sales.push(sale);
      } else if (isBought(row)) {
        const seen = add(pile, "toYou", 0);
        seen.keptByThem = (seen.keptByThem ?? 0) + mesos;
      } else {
        const seen = add(pile, "toYou", mesos);
        seen.salesToYou = [...(seen.salesToYou ?? []), sale];
      }
    }
  }
  return out;
}

/** What coupon sales came to, in the two figures a sold drop reports. See couponMoney. */
export type CouponMoney = { pooled: number; yourTake: number };

/** Nothing sold, for a caller that leaves the coupon piles out. */
export const NO_COUPON_MONEY: CouponMoney = { pooled: 0, yourTake: 0 };

/**
 * What the coupon piles have fetched, said the way a sold drop says it.
 *
 * A coupon row settles through this ledger, never through a sale on its own row. Left out:
 *
 *  - a redemption, which realized nothing.
 *  - a purchase, which is pieces bought INTO the pile. That money goes the other way.
 *  - a tranche neither side of which is yours (buildWallet's `betweenOthers`).
 *
 * Priced exactly as saleCredits prices a share, rounding included.
 */
export function couponMoney(rows: TrancheRow[]): CouponMoney {
  let pooled = 0;
  let yourTake = 0;
  for (const row of rows) {
    const { amount } = row;
    if (amount === null || row.pieces < 1 || isBought(row)) continue;
    const shares = row.shares ?? [];
    const mesosOf = (of: (key: string) => boolean) =>
      shares
        .filter((s) => of(holderKey(s.holder)))
        .reduce((sum, s) => sum + Math.round((s.pieces * amount) / row.pieces), 0);

    if (holderKey(row.holder) === SELF_KEY) {
      pooled += amount;
      // The lot less the coupons in it that were somebody else's. A row naming nobody is all yours.
      yourTake += Math.max(0, amount - mesosOf((key) => key !== SELF_KEY));
    } else {
      // Their lot, with coupons of yours in it. Only your shares are yours to count.
      const mine = mesosOf((key) => key === SELF_KEY);
      if (mine === 0) continue;
      pooled += amount;
      yourTake += mine;
    }
  }
  return { pooled, yourTake };
}

/**
 * The key a closure is remembered by: one holder's decision about one drop. A split drop sits in
 * several piles, and closing one says nothing about the others.
 */
export function closureKey(holder: Holder, lootId: string): string {
  return closureKeyOf(holderKey(holder), lootId);
}

/** The same key for a caller holding the holder's KEY already. */
export function closureKeyOf(holder: string, lootId: string): string {
  return `${holder}|${lootId}`;
}

/** Every (holder, drop) whose books are closed, and what each act wrote off. See V52. */
export function closedByHolder(rows: { holder: Holder; lootIds: string[]; unpaid: number }[]): {
  closed: Set<string>;
  writtenOff: Map<string, number>;
} {
  const closed = new Set<string>();
  const writtenOff = new Map<string, number>();
  for (const row of rows) {
    for (const lootId of row.lootIds) closed.add(closureKey(row.holder, lootId));
    const key = holderKey(row.holder);
    writtenOff.set(key, (writtenOff.get(key) ?? 0) + row.unpaid);
  }
  return { closed, writtenOff };
}

/**
 * The drops a holder still has open, which is what a rotation should be measured against.
 *
 * A closed debt was compensated, so it must not tilt next week's suggested arrangement.
 */
export function stillOpen(drops: OutstandingDrop[], closed: Set<string>): OutstandingDrop[] {
  return drops.filter((d) => !closed.has(closureKey(d.holder, d.lootId)));
}

/**
 * Mesos each holder has actually handed over. See V51.
 *
 * A total: what a holder still owes is one number.
 */
export function receivedByHolder(rows: { holder: Holder; amount: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = holderKey(row.holder);
    out.set(key, (out.get(key) ?? 0) + row.amount);
  }
  return out;
}

/**
 * The payments no closure has already spoken for, per holder, and the ones it has.
 *
 * Money that arrived before Mark Settled is what closed the books: it is spent, and cannot pay for
 * anything entered afterwards (a closed thing counts towards no current total).
 *
 * By TIME rather than amount, because a settlement records no figure to match against. The last
 * closure is the line. Receipts rather than a sum, because the card lists them; oldest first.
 */
export function paymentsSinceClosing<T extends { holder: Holder; receivedAt: string }>(
  payments: T[],
  settlements: { holder: Holder; settledAt: string }[],
): Map<string, { counted: T[]; spent: T[] }> {
  const closedAt = new Map<string, string>();
  for (const row of settlements) {
    const key = holderKey(row.holder);
    const seen = closedAt.get(key);
    if (seen === undefined || row.settledAt > seen) closedAt.set(key, row.settledAt);
  }

  const out = new Map<string, { counted: T[]; spent: T[] }>();
  for (const row of [...payments].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    const key = holderKey(row.holder);
    const closed = closedAt.get(key);
    const split = out.get(key) ?? { counted: [], spent: [] };
    // ISO 8601 as the server writes it, so lexical order is chronological and no date is parsed.
    if (closed !== undefined && row.receivedAt <= closed) split.spent.push(row);
    else split.counted.push(row);
    out.set(key, split);
  }
  return out;
}

/** What those receipts come to, per holder. The figure buildSettlement nets against. */
export function receivedSinceClosing(
  payments: { holder: Holder; amount: number; receivedAt: string }[],
  settlements: { holder: Holder; settledAt: string }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, split] of paymentsSinceClosing(payments, settlements)) {
    if (split.counted.length === 0) continue;
    out.set(
      key,
      split.counted.reduce((sum, row) => sum + row.amount, 0),
    );
  }
  return out;
}

/** Pieces of the pile nobody has said the fate of yet. Floored, so a miscount does not read negative. */
export function unaccounted(ledger: HolderLedger): number {
  return Math.max(0, ledger.pieces - ledger.accounted);
}

/**
 * Every pile this loot row sits in, for the row's own read-only display.
 *
 * A list, not one entry: a drop looted stack by stack is in several piles, and answering with the
 * first would quietly drop the others.
 */
export function ledgerForLoot(
  ledgers: HolderLedger[],
  lootId: string,
): { holderName: string; drop: HolderLedger["drops"][number] }[] {
  return ledgers.flatMap((ledger) =>
    ledger.drops
      .filter((d) => d.lootId === lootId)
      .map((drop) => ({ holderName: ledger.holderName, drop })),
  );
}
