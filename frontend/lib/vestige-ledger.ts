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
// A third case exists and is deliberately NOT answered: the drop did not divide and nobody has
// said who took the odd stack. It used to be called rare and skipped, which was wrong twice over.
// Seven of the eleven vestige rows fall in 3 stacks, so no duo can divide them and it is the
// ordinary night; and skipping it recorded no debt at all rather than an unknown one. It is
// `unanswered()` now, and it names the size of the hole without guessing its direction.
//
// A HOLDER is a person, not a character. Seats are folded to their holder before anything is
// counted, which is what makes a party of your own two characters owe nothing at all: you cannot
// owe yourself. It is also why one person running three characters has one pile and one box, rather
// than three of each saying the same human owes you three times.

import {
  type LedgerDrop,
  balances,
  entitlements,
  heldOf,
  ownShareOf,
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
   * Beside `weekStart` rather than derived from it: the queue is drawn in the catalog's order so two
   * bosses in one week never swap places, and that order is not the order the nights happened in. A
   * sale cannot have come off a night that fell after it, and the week alone cannot tell them apart.
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
  /**
   * Of those, how many are YOURS, and what the sold ones have made you.
   *
   * The figure to lead with on somebody else's card: what they are holding is their business, and
   * what you are owed out of it is the reason the card exists. Zero on your own card, where the
   * debts run the other way.
   */
  owedToYou: number;
  /**
   * Mesos that have arrived from them. See V51.
   *
   * The fact nothing else can know, and now the ONLY money on this type. What a piece debt is worth
   * is not derivable: coupons are single-trade, so only the holder can sell them, and the two sides
   * come off different nights at different prices. So the pieces are stated as a count and this is
   * whatever they have actually sent against it.
   */
  received: number;
  /**
   * Pieces of the pile they are redeeming rather than selling, as entered.
   *
   * More than `pieces` is a miscount, and the two are carried side by side so it can be said out loud
   * rather than clamped away: every drop reads as fully kept and the surplus is nowhere.
   */
  kept: number;
  /**
   * Pieces of the pile that are their OWN, which is the most they can redeem.
   *
   * What the kept box is bounded by. Pieces of yours they take anyway are a purchase, priced, rather
   * than a redemption priced off whatever their own sales happened to reach. See V50.
   */
  ownShare: number;
  /** Pieces of yours they bought outright, and what they agreed to pay. See V50. */
  bought: { pieces: number; paid: number };
  /** Pieces entered as sold, whatever the queue has managed to spend them on. */
  soldPieces: number;
  /**
   * Pieces of this pile that have been answered with money rather than with coupons. See V56.
   *
   * The creditor has a figure on their Settlement card instead of their coupons, so the pile is not
   * still waiting to be told what became of them. See answeredByHolder for the two ways in.
   */
  answered: number;
  /**
   * The same pieces, split by WHO they answered. See answeredByPair.
   *
   * `answered` is the pile's total and cannot retire a night: which nights are finished is a question
   * per creditor, and spending one person's sold coupons on a night owed to another is the
   * cross-person netting `owes` already refuses. See queueOf.
   *
   * One entry per SALE, not a total: the spend needs the day each was made, so a sale cannot answer
   * a night that was not on the books yet. See spendSales.
   */
  answeredByCreditor: Map<string, AnsweredSale[]>;
  /**
   * Every drop under this holder has had its books closed, so the card is done. See V52.
   *
   * Not derived from the money, and it cannot be: a drop is queued on `entitled - looted`, fixed when
   * it was logged, so nothing about a sale or a payment can retire it. Somebody decides.
   */
  closed: boolean;
  /** Mesos written off across the acts that closed this pile. Said, because a write-off is a decision. */
  writtenOff: number;
  /**
   * Pieces of the pile whose fate has been entered: sold, kept, or taken.
   *
   * What the card counts towards `pieces`, and the nearest thing it has to an instruction: the gap
   * between the two is exactly what it is still waiting to be told. Above `pieces` is a miscount, and
   * carried raw so it can be said rather than clamped.
   */
  accounted: number;
  drops: {
    lootId: string;
    partyId: string;
    bossKey: string | null;
    weekStart: string;
    /** The day it fell. What a debt is answered in the order of, never what it is drawn in. */
    droppedOn: string;
    /** When it was LOGGED, which is what says a sale could have answered it. See spendSales. */
    recordedAt?: string;
    /** Which of this holder's characters looted it. */
    looterName: string;
    /** Every character who ran that night. */
    ran: string[];
    pieces: number;
    /** Its books are closed, so it is history rather than something anybody is waiting on. See V52. */
    closed: boolean;
    transfers: PieceTransfer[];
  }[];
};

/**
 * Who a seat belongs to.
 *
 * Your own characters are not on the people list at all, so they are not "unattributed": they are
 * you, which is what `characterId` says. Getting that wrong is the difference between a party of
 * your two characters owing nothing and it owing you half of what you already have.
 */
export function holderOf(seat: PartyMember): Holder {
  if (seat.personId !== null)
    return { kind: "PERSON", personId: seat.personId, characterName: null };
  if (seat.characterId !== null) return { kind: "SELF", personId: null, characterName: null };
  return { kind: "CHARACTER", personId: null, characterName: seat.name.trim().toLowerCase() };
}

/** You, as a holder key. The one seat on any drop whose side of a debt is your own. */
export const SELF_KEY = "self";

/** You, as a holder. Written when an act is your own pile's decision, which closing a pair is. */
export const SELF_HOLDER: Holder = { kind: "SELF", personId: null, characterName: null };

/** How a holder is matched, on either side of the wire. One pile, one key, however it is spelled. */
export function holderKey(holder: Holder): string {
  if (holder.kind === "PERSON") return `person:${holder.personId}`;
  if (holder.kind === "SELF") return SELF_KEY;
  return `character:${holder.characterName}`;
}

/**
 * holderKey() read back.
 *
 * A piece transfer names its creditor by key alone, because that is what a debt is matched on. Writing
 * a sale's attribution needs the holder itself, and rebuilding it from the key beats threading a
 * second field through the ledger for the one caller that wants it.
 */
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
 * Off the transfers the drops already carry, so this names nobody the boss rows do not. Only OPEN
 * drops: a closed one was settled, and offering to credit somebody out of it would pay a debt twice.
 *
 * Biggest debt first, so the box the ordinary sale wants is the one at the top.
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

/** What to call a holder. Yours are "you", because that is who they are on your own screen. */
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
 * The one place seats become people, so a debt, a share and a count are all measured against the
 * same list. Two characters of one person are one holder with two shares: they are owed twice as
 * much as somebody who brought one, and they are owed it once.
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
 * Derived on every read and stored nowhere. The inputs (who ran, how the shares fall) are edited
 * long after a drop is filed, and a stored share does not follow them: that is what had one Limbo
 * row reading 60 for a character who got 20. See V40.
 *
 * Zero when none of the seats are yours, which is a party you keep the books for but did not run.
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
 * divides by looting alone only when that is a whole number for every one of them. A duo on 3
 * stacks cannot: 1.5 each, and somebody walks off with the odd one.
 *
 * Measured on FOLDED holders, never on seats. Three stacks between three characters where one
 * person brought two of them divides perfectly, and reading it per seat would report a debt that
 * does not exist.
 */
export function dividesEvenly(bundles: number, holders: FoldedSeat[]): boolean {
  const weight = holders.reduce((sum, h) => sum + h.shares, 0);
  if (weight <= 0) return false;
  return holders.every((h) => (bundles * h.shares) % weight === 0);
}

/**
 * The seats that ran the week THIS drop fell in.
 *
 * A pool spans months and `party.members` is one week's answer, whichever week the page happened to
 * ask for. So measuring an August drop against September's roster owes a share to somebody who was
 * not there, which is the wrong number this file exists to avoid. The loot row carries
 * `ranThatWeek` for exactly this, and loot-row.tsx and lot-sale.ts have read it all along.
 *
 * Falls back to `party.members` when the week names nobody. That is a party whose every seat has
 * been retired, where the drop's week has no answer at all and the page's week is the only one
 * there is. Reading it as an empty roster instead would say none of the drop is yours.
 */
export function ranSeats(loot: Loot, party: Party): PartyMember[] {
  const ran = party.seats.filter((seat) => loot.ranThatWeek.includes(seat.id));
  // On the share that was in force THAT WEEK, not the one the party is on now. A deal agreed today
  // must not re-divide a drop from a week somebody has already been shown a figure for, which is
  // what pinWeeksAlreadyWritten froze and this is what reads it. Absent is the standing share,
  // which is every week nobody has changed the deal behind, and every row written before V55.
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
 * There was a third, a party's standing looter holding the lot. Its picker went in #393 and the
 * value lived on unseen, so it was retired (V78) rather than left to decide nights nobody could see.
 */
function heldByHolder(loot: Loot, party: Party, holders: FoldedSeat[]): Map<string, Pile> | null {
  const held = pilesFrom(loot, party, holders);
  if (held === null) return null;
  // Everybody who ran, including whoever bent down for nothing. Reading the arrangement alone left
  // the empty-handed out of the map entirely, and the night one person loots WHOLE is the ordinary
  // one: it read as a night with nobody on the other side, so "60 to hand over" went unsaid. Only
  // that direction was silent, because the reader was looking for a pile and yours was the only one.
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
        // One person can bend down twice. Both characters are named, because which of them is
        // holding the coupons is the thing the row exists to tell them.
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
   * `by` as a key, which is the CREDITOR when the coupons are yours to hand over.
   *
   * What matches the night against a tranche that already sold their share of it. The name cannot:
   * a pile of two characters is named as both and a person is named however the seat spells them.
   */
  byKey: string;
};

/**
 * One night's coupon debt, in whichever direction it runs.
 *
 * The GAP, never a whole share. A night where you picked up four stacks of six and were entitled to
 * three owes you nothing and leaves you holding one stack of theirs, which is the same subtraction
 * read from the other end. The Drop Log used to take the named looter and report your full share, so
 * Extreme Kalos said "90 coupons owed" over a night whose own arrangement had you holding 120 of the
 * 180: the wrong figure, pointing the wrong way, when you owed 30 back. Same class as #289, one
 * screen along.
 *
 * Through heldByHolder, so the order of authority is that function's: the night's own arrangement,
 * then an even division. Null where it returns null, because nobody has said
 * who took the odd stack and a guess names the wrong person half the time. That night is not silent
 * on screen: it is what unanswered() lists and what the stack boxes ask for.
 *
 * Null on a pool with one seat too. There is nobody to owe when the only seat is yours.
 */
export function couponGapOf(loot: Loot, party: Party): CouponGap | null {
  const ran = ranSeats(loot, party);
  if (ran.length < 2) return null;
  const holders = foldSeats(ran);
  const held = heldByHolder(loot, party, holders);
  if (held === null) return null;
  const mine = held.get(SELF_KEY)?.pieces ?? 0;
  const short = yourShare(loot.quantity, ran) - mine;
  if (short === 0) return null;
  // Whoever is furthest from their own share is the other side of it. Named, because which of them
  // to ask is the whole use of the figure, and a pile of two characters names both (see Pile.by).
  //
  // "Furthest" runs opposite to yours: the one holding most of a surplus when you are short, the
  // one shortest when you are the one holding. Ranking on the pile alone answered only the first,
  // and on a trio it named the biggest pile even where a bigger entitlement had earned it.
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
 * How many stacks a drop fell in, with a row that predates the field reading as uncounted.
 *
 * The cache in lib/cache.ts holds whatever shape the API had when the page last fetched, typed as
 * whatever it is read back as. So a tab open across a deploy that adds a field hands this code a
 * row without it, and `undefined !== null` is TRUE: the checks would pass and the arithmetic would
 * run on nothing, which is a NaN on screen rather than an error anybody sees.
 *
 * Absent and null are the same answer here, so say so once rather than at four call sites.
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
  /**
   * The seats that ran that week, which is who a stack may be handed to.
   *
   * Carried rather than read off the party by the card: the party's roster is the week the page
   * asked for, so a guest who ran the night this drop fell would not be offered a stack they are
   * holding.
   */
  seats: PartyMember[];
  /**
   * Pieces that cannot be where they belong, whoever picked up what.
   *
   * Known exactly even though the direction is not: the arrangement closest to even is forced, so
   * the SIZE of the imbalance follows from the stacks and the shares alone. It is the one useful
   * thing that can be said about a night nobody has answered for.
   */
  imbalance: number;
};

/**
 * Drops that did not divide and that nobody has answered for.
 *
 * These owe somebody, and until the arrangement is recorded there is no saying who. Listed rather
 * than dropped: outstanding() used to skip every party with no looter, so an uneven night filed a
 * row and recorded no debt at all, silently. A missing item beats a wrong count, but a missing item
 * still has to be visible.
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
      // Per drop, not per pool: a party that ran as a trio in July and a duo in August divides its
      // two nights differently, and one roster for the pool would answer for the wrong one.
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
 * Positive is owed pieces, negative is holding somebody else's. Only what has been recorded, so it
 * moves when an earlier week is edited. That is why it may only ever SUGGEST an arrangement and
 * never be stored as one: a stored figure derived from this would be rewritten by the next edit.
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
 * The odd stack goes to whoever is furthest BEHIND, so it rotates on its own and the debts
 * alternate direction instead of piling up one way. A party that does not want it to rotate says so
 * with its SHARES: taking four of six stacks permanently is being entitled to four of six, and said
 * that way it divides exactly and there is no odd stack to hand anybody.
 *
 * A suggestion: nothing is written until somebody says this is what happened.
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
      // Their HOLDER's position, not the seat's: two characters of one person are one pile, and
      // giving the odd stack to their second character would not move the debt at all.
      owed: behind.get(holderKey(holderOf(s))) ?? 0,
    }))
    .sort((a, b) => b.fraction - a.fraction || b.owed - a.owed || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    share[i] = (share[i] ?? 0) + 1;
    left -= 1;
  }
  // A seat with no stacks is left out rather than given a zero: the server refuses a zero, because
  // somebody who did not bend down is absent from the arrangement, not present with none.
  const out = new Map<string, number>();
  seats.forEach((s, i) => {
    if ((share[i] ?? 0) > 0) out.set(s.id, share[i]!);
  });
  return out;
}

/**
 * Every drop that still owes somebody, oldest first.
 *
 * One row per HOLDER holding pieces of a drop, not one per drop. A drop looted stack by stack sits
 * in several piles at once, each draining its own owner's tranches, and one row could only ever
 * describe one of them.
 *
 * A drop owes nothing and is left out when every pile matches its owner's share: a party whose
 * stacks divide, or one whose seats are all ONE person however many characters they brought. What
 * is NOT left out any more is the night that did not divide with no arrangement recorded. That is
 * `unanswered()`, and it used to vanish from here without a word.
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
      // Who ran THAT WEEK is who the shares are measured against, the same list a payout uses. Seats
      // folded to holders: two characters of one person are one share of the drop and one party to
      // the debt, so a night that folds to a single holder is nobody owing anybody.
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
      // Everybody is exactly on their share, so there is nothing to settle and no pile to queue.
      if (balances(loot.quantity, seats).every((b) => b.balance === 0)) continue;

      for (const [key, pile] of held) {
        const holder = byKey.get(key);
        if (!holder || pile.pieces < 1) continue;
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
 * That one queues DEBTS, so it drops two kinds of night on purpose: one everybody landed square on,
 * and a boss you ran alone. Nobody owes anything on either, so there is nothing to settle.
 *
 * Those coupons are still in your inventory and still sell. A Sale Ledger that will not admit you
 * hold them cannot take the sale, and it does not say so: it counted 80 against the 200 really
 * held, because a Jupiter stack that divided three ways and a Malefic Star that divided two both
 * came out square. Only YOUR piles, because a pile you cannot sell from needs no row here.
 *
 * Kept apart from `outstanding` rather than folded into it: the wallet and the party list read that
 * one for what is OWED, and a balanced night owes nothing. Widening it would put a row with no debt
 * into both.
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

      // Nobody else was there, so every piece that fell is yours and there is no arrangement to
      // read. `heldByHolder` cannot answer this one: it divides by the holders' weight, and a lone
      // holder never reaches that branch because `holdersOf` refuses a night of fewer than two.
      const held =
        holders.length === 1
          ? new Map([[SELF_KEY, { pieces: loot.quantity, by: ran[0]?.name ?? mine.name }]])
          : heldByHolder(loot, party, holders);
      if (held === null) continue;
      const pile = held.get(SELF_KEY);
      if (!pile || pile.pieces < 1) continue;

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
 * Sales are per holder because that is who sold them. One person's characters share a queue: the
 * coupons cannot move between their inventories, but mesos are fungible and what the ledger settles
 * is what that human owes. Which character looted a boss is carried on the row for that reason.
 */
export function holderLedgers(
  drops: OutstandingDrop[],
  /** Pieces each holder has sold. A count: no debt is priced off a sale any more. */
  salesByHolder: Map<string, number>,
  /**
   * Pieces each holder is redeeming rather than selling. Absent is none, which is every pile before
   * V46 and still most of them.
   */
  keptByHolder: Map<string, number> = new Map(),
  /** Pieces of yours each holder bought outright, and what they agreed to pay. See V50. */
  boughtByHolder: Map<string, { pieces: number; paid: number }> = new Map(),
  /** Mesos that have actually arrived from each holder. See V51. */
  receivedByHolder: Map<string, number> = new Map(),
  /**
   * Which (holder, drop) pairs have had their books closed, and what was written off. See V52.
   *
   * A closed drop keeps its row and its figures, and is priced against the other closed drops alone,
   * so nothing entered later can move it. It counts towards none of the ledger's totals: those are
   * what is still owed, and a closed drop is not.
   */
  closures: { closed: Set<string>; writtenOff: Map<string, number> } = {
    closed: new Set(),
    writtenOff: new Map(),
  },
  /** Pieces each pile has answered for with money rather than coupons. Absent is none. See V56. */
  answeredByHolder: Map<string, number> = new Map(),
  /**
   * The same pieces per (pile, creditor), a sale at a time, which is what retires a night. See
   * answeredSalesByPair.
   *
   * Absent leaves every night on the queue while any of the pile is outstanding, which is what this
   * did before a night could be retired at all.
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
      // Only what THIS holder owes. A split drop has a row in each pile it sits in, and every one of
      // them would otherwise repeat the whole drop's debts, counting each once per pile.
      transfers: transfersOf(d.drop, key),
    }));

    // Pieces of YOURS they are sitting on, from the drops still open. A closed one has been settled,
    // so counting it again asks for a debt somebody has already paid.
    const owedToYou = drops
      .filter((d) => !d.closed)
      .flatMap((d) => d.transfers)
      .filter((t) => t.toId === SELF_KEY)
      .reduce((sum, t) => sum + t.pieces, 0);

    ledgers.push({
      holder: mine[0]!.holder,
      holderName: mine[0]!.holderName,
      // Every drop, closed ones included, and the same is true of `accounted`. This pair is the Sale
      // Ledger's instruction to YOU and the two sides have to be drawn from the same set: a coupon
      // already sold still dropped, and taking it off one side alone would reopen the gap every time
      // a boss was closed. Closing is about a DEBT, and your own pile owes you nothing.
      pieces: drops.reduce((sum, d) => sum + d.pieces, 0),
      owedToYou,
      received: receivedByHolder.get(key) ?? 0,
      kept,
      ownShare: mine.reduce((sum, d) => sum + ownShareOf(d.drop, key), 0),
      bought,
      soldPieces,
      // Not in `accounted`, which counts what became of the PILE: these pieces were sold or taken and
      // are already in one of those counts. This says which of them answered somebody's debt.
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
      // Every drop closed, so there is nothing here anybody is waiting on. A pile with no drops at all
      // cannot be closed: there would be nothing to have decided about.
      closed: drops.length > 0 && drops.every((d) => d.closed),
      writtenOff: closures.writtenOff.get(key) ?? 0,
      drops,
    });
  }
  // Closed piles last, then by name. Still listed, because the rows recorded against one are
  // corrected from its card and nowhere else. Out of the way is not the same as gone.
  return ledgers.sort(
    (a, b) => Number(a.closed) - Number(b.closed) || a.holderName.localeCompare(b.holderName),
  );
}

/**
 * One tranche as these functions read it. `disposition` absent is a row cached from before V50.
 *
 * Named because three readers now have to agree on it, and on what an ABSENT disposition means.
 */
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
 * The one place `disposition` is read, and it is read POSITIVELY: absent can only mean a row cached
 * from before BOUGHT existed, so it is never one. Testing for SOLD instead would be the cache trap
 * in `bundlesOf` below, and worse: lib/cache.ts hands back whatever shape the API had when the page
 * last fetched, and `undefined !== "SOLD"` is TRUE, so a tab open across the deploy would drop every
 * sale already entered.
 */
function isBought(row: TrancheRow): boolean {
  return row.disposition === "BOUGHT";
}

/**
 * How many pieces each holder has SOLD, keyed the way holderLedgers wants them.
 *
 * Rows with money in them, minus the purchases. A KEPT row is pieces redeemed rather than sold, and
 * a BOUGHT row is the creditor's pieces taken at an agreed price; each is counted by its own function
 * below, because the three are different fates and only their sum is what the pile has been told.
 *
 * A COUNT, not the prices. The tranche's amount is still stored and still shown on its own row, but
 * nothing derives a per-piece figure from it any more: that existed to apportion the money over the
 * bosses in the queue, and no debt is priced that way now.
 *
 * The AMOUNT is what separates a sale from a redemption, which V50 keeps equivalent by check
 * constraint. Only the purchase needs the disposition, and `isBought` says why that direction is the
 * safe one to test.
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
 * A total, because only the total matters: nothing asks which boss a redeemed piece came off any
 * more, and the rows exist separately so a redemption entered by mistake can be removed.
 *
 * Rows with no money, the same test `salesByHolder` uses and for the same reason: V46 makes the
 * amount and the disposition equivalent by check constraint, and reading `disposition` would read
 * `undefined` on a response cached from before the field existed.
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
 * One count and one total per holder, so several purchases at different prices blend. No boss is
 * named on one, for the same reason a sale names none: a coupon in an inventory carries no record of
 * the clear it fell on, and nothing needs to know now that no debt is priced boss by boss.
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
 * Pieces, not mesos: what the money came to is saleCredits' answer, and this is the count that stops
 * the pile asking about them. Two ways in, and the whole rule is here rather than split between here
 * and settledOf, because the two must not count the same pieces twice:
 *
 *  - pieces a priced tranche NAMED as somebody else's, sale or purchase alike.
 *  - pieces on a purchase that named nobody, which is every purchase entered before this. A purchase
 *    is one creditor's in full by definition (V50), so its count stands on its own.
 */
export function answeredByHolder(rows: TrancheRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === null) continue;
    const key = holderKey(row.holder);
    const named = (row.shares ?? [])
      .filter((s) => holderKey(s.holder) !== key)
      .reduce((sum, s) => sum + s.pieces, 0);
    // Capped at the tranche, which the server enforces too. A cached row from a build that did not
    // would otherwise answer for more pieces than it held.
    const answered = named > 0 ? Math.min(named, row.pieces) : isBought(row) ? row.pieces : 0;
    if (answered > 0) out.set(key, (out.get(key) ?? 0) + answered);
  }
  return out;
}

/** How one pile's answer to one creditor is keyed. Both halves, because a pile owes each separately. */
export function answeredKey(pile: string, creditor: string): string {
  return `${pile}|${creditor}`;
}

/**
 * The same pieces, per (pile, creditor) instead of per pile. See V56.
 *
 * The Sale Ledger asks what a PILE still owes, so a pile total answers it. The Settlement Ledger owes
 * each person separately, and subtracting a pile total there would take one person's sold coupons off
 * whichever card was being drawn. That is the plausible wrong number this repo exists to prevent, so
 * the attribution the tranche already carries is kept rather than summed away.
 *
 * Only the rows that NAMED a creditor. A purchase that named nobody is one creditor's in full by
 * definition (V50) and does not say which, so it stays in answeredByHolder's total and is attributed
 * to nobody here: naming one would discharge a debt against somebody who never agreed to it.
 *
 * Capped against the tranche in share order, the same cap answeredByHolder applies to the total, so a
 * row cached from a build that did not enforce it answers for what fell and no more.
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
 * A sum cannot say when it was earned, and the spend needs to know: a sale only answers nights that
 * were already on the books when it was recorded. Summing first and spending after is what let a
 * sale from last week answer a night logged tonight. See spendSales.
 *
 * A row with no soldAt is one cached from before the field. It sorts first and reaches every night,
 * which is what it did when it was cached.
 */
export function answeredSalesByPair(rows: TrancheRow[]): Map<string, AnsweredSale[]> {
  const out = new Map<string, AnsweredSale[]>();
  for (const row of rows) {
    if (row.amount === null) continue;
    const pile = holderKey(row.holder);
    let left = row.pieces;
    for (const share of row.shares ?? []) {
      const creditor = holderKey(share.holder);
      // A share naming the pile's own holder answers nothing and spends none of the budget: a pile
      // owes itself nothing, which is the case answeredByHolder filters out before it counts.
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
 * Their pieces and their share of the price, never the whole lot: 70 of Bro's out of a lot of 70 and
 * 70 of his out of a lot of 200 put different money on his card.
 */
export type CouponSale = {
  /**
   * The tranche it came off, so a decision about the money can be told back to the pill that records
   * the sale. The Sale Ledger folds a sale away once its money has been decided, and it can only know
   * which sales those were from the one spend that matched them. See decidedSales.
   */
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
   * The tranches behind `toThem`, in the order the API returned them, which is oldest first.
   *
   * That side alone, because it is the side with an act on it: the money sits in your hands until
   * somebody decides about it, and a decision names no tranche, so the card can only say which sales
   * it was made of by matching them off in this order. See moneyRows.
   */
  sales: CouponSale[];
};

/**
 * What each counterparty is owed, or owes, out of priced tranches of somebody else's pieces. See V56.
 *
 * The one place a piece debt gets a price, and it only ever does so from a tranche WHOSE PRICE THE
 * ENTERER TYPED. That is what makes it different from the pro rata #354 deleted: this divides one
 * tranche, one lot at one price, between the people whose coupons were in it. It never spreads a
 * holder's proceeds over a queue of bosses, and it never asks what somebody else sold at.
 *
 * A PURCHASE counts, at the price it names. "I took theirs, at a price" is the whole act of keeping
 * somebody's coupons instead of handing them back, so leaving it out meant the pieces left the pile
 * settled and the money for them was stated nowhere.
 *
 * Rounded to the meso, with the remainder left on the seller's side: the two must add up to the
 * tranche exactly, and the person who typed the figure is the one who can check it.
 *
 * A row where neither side is you is left out. That debt is real and it is between two other people,
 * the same case buildWallet counts as `betweenOthers` rather than putting in your totals.
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
    // A price to divide, and pieces to divide it over. A redemption has neither: it realized nothing,
    // which is why the server still refuses shares on one. See V50.
    if (row.amount === null || row.pieces < 1) continue;
    const pile = holderKey(row.holder);
    for (const share of row.shares ?? []) {
      const creditor = holderKey(share.holder);
      if (pile !== SELF_KEY && creditor !== SELF_KEY) continue;
      const mesos = Math.round((share.pieces * row.amount) / row.pieces);
      // The row is listed off the same figure it is counted by, in one pass: a second walk to
      // itemise what this one totalled is a second answer, and the rounding above is exactly the
      // kind of step the two would come to disagree over.
      if (pile === SELF_KEY)
        add(creditor, "toThem", mesos).sales.push({
          trancheId: row.id,
          pieces: share.pieces,
          mesos,
          lot: { pieces: row.pieces, amount: row.amount },
          soldAt: row.soldAt ?? null,
        });
      else add(pile, "toYou", mesos);
    }
  }
  return out;
}

/** What coupon sales came to, in the two figures a sold drop reports. See couponMoney. */
export type CouponMoney = { pooled: number; yourTake: number };

/** Nothing sold, for a caller that has decided the coupon piles are not part of what it is showing. */
export const NO_COUPON_MONEY: CouponMoney = { pooled: 0, yourTake: 0 };

/**
 * What the coupon piles have fetched, said the way a sold drop says it.
 *
 * A coupon row settles through this ledger and never through a sale on its own row, so the Drop
 * Log's money was every sale the account had made EXCEPT the vestiges.
 *
 * Left out, and why:
 *
 *  - a redemption, which realized nothing. Same test as elsewhere: no amount, no sale.
 *  - a purchase, which is pieces bought INTO the pile. That money goes the other way.
 *  - a tranche neither side of which is yours, the case buildWallet calls `betweenOthers`.
 *
 * A share is priced the way saleCredits prices one, rounding included, so the same coupons are the
 * same mesos here and on the card that asks for them.
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
      // The lot less the coupons in it that were somebody else's. A row naming nobody is all yours,
      // which is every tranche entered before V56.
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
 * The key a closure is remembered by: one holder's decision about one drop.
 *
 * Both halves, because a drop split at the stack sits in several piles and closing one person's books
 * says nothing about anybody else's.
 */
export function closureKey(holder: Holder, lootId: string): string {
  return closureKeyOf(holderKey(holder), lootId);
}

/** The same key for a caller holding the holder's KEY already, so the format lives in one place. */
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
 * A closed debt was compensated, so it has no business tilting next week's suggested arrangement: a
 * holder who took the odd stack four weeks running and paid for it every time would otherwise keep
 * being suggested against forever.
 */
export function stillOpen(drops: OutstandingDrop[], closed: Set<string>): OutstandingDrop[] {
  return drops.filter((d) => !closed.has(closureKey(d.holder, d.lootId)));
}

/**
 * Mesos each holder has actually handed over. See V51.
 *
 * A total, like the redemptions: what a holder still owes is one number, and which boss a meso
 * retires is already the queue's answer. The rows exist separately so a mistyped receipt can be
 * removed the way a mistyped tranche is.
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
 * Mark settled says the books are closed, so the money that arrived before it is what closed them:
 * it is spent, and it cannot pay for anything entered afterwards. Bro sold 195 coupons for 4.856b,
 * sent 4.86b, and the pile was settled twenty minutes later. Counted raw, that finished 4.86b came
 * straight off the next debt entered against him, which is #350's rule ("a closed thing counts
 * towards no current total") being broken one ledger further along.
 *
 * By TIME rather than by amount, because a settlement records no figure to match against: it names
 * the drops it closes and what was written off, and a payment is against the holder's whole debt
 * rather than any drop. The last closure is the line, so a payment arriving after one counts.
 *
 * The receipts rather than their sum, because the card lists them one by one: a payment that counts
 * is a row in the arithmetic and a spent one is not, and a card that could only see the total had to
 * draw every receipt somewhere else. Oldest first, the order the money moved in.
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

/**
 * Pieces of the pile nobody has said the fate of yet. Floored, so a miscount does not read negative.
 *
 * The card's one instruction while there are any: this many pieces are in somebody's inventory and
 * the ledger has not been told what became of them. Zero is every piece accounted for, which is when
 * the money becomes the only question left.
 */
export function unaccounted(ledger: HolderLedger): number {
  return Math.max(0, ledger.pieces - ledger.accounted);
}

/**
 * Every pile this loot row sits in, for the row's own read-only display.
 *
 * A list, not one entry: a drop looted stack by stack is in as many piles as there were people
 * bending down, and answering with the first would name one holder and quietly drop the others.
 * One entry is the ordinary case, where a single looter holds the lot.
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
