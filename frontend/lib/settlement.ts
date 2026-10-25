// What stands between you and each other person, in one place.
//
// The MONEY is one net figure, because one transfer of the difference settles a pair and saves a
// hop's Auction House fee. Every input is a typed figure or a split of one:
//
//   - shares of a sale, either direction (lib/wallet.ts)
//   - what you sold of THEIR coupons out of your own pile (V56)
//   - what they owe you from anywhere else, entered by hand (V56)
//   - what has actually been paid (V51)
//
// PIECES are not in it and cannot be. Coupons are single-trade, so pieces of yours in somebody else's
// inventory can only be sold by them, at a price you cannot see. They stay a count. See V56.
//
// No total is computed here. The shares are lib/wallet.ts's, the pieces and the sale splits are
// lib/vestige-ledger.ts's, and a second copy of any of them would be a second answer.

import { placeSales, placeSalesOnNights, spendSales } from "./piece-ledger";
import type { AnsweredSale } from "./piece-ledger";
import { SELF_KEY, answeredKey, holderFromKey, holderKey } from "./vestige-ledger";
import type { CouponSale, Holder, HolderLedger, SaleCredit } from "./vestige-ledger";
import type { Currency } from "./money";
import type { Owings, Wallet, WalletLine } from "./wallet";
import type {
  ProceedsDisposal,
  SettlementDebt,
  SettlementDebtPayout,
  WrittenBy,
} from "@/types/vestige";

/** One night's coupons sitting in the wrong inventory, in whichever direction it runs. */
export type HeldOfYours = {
  lootId: string;
  partyId: string;
  bossKey: string | null;
  weekStart: string;
  /** The day it fell, which is the order a debt is answered in. See spendOldestFirst. */
  droppedOn: string;
  /** When it was LOGGED, which is what says a sale could have answered it. See spendSales. */
  recordedAt?: string;
  /**
   * Pieces this person is still owed off this night, never the size of the pile holding them.
   * `pieces + sold` is what the night owed to begin with.
   */
  pieces: number;
  /** Pieces of this night a recorded sale already answered for. See spendSales. */
  sold: number;
  /** Which character bent down for them. */
  looterName: string;
  /** Every character who ran that night. */
  ran: string[];
  /**
   * True when the pile holding them owes somebody ELSE off the same night.
   *
   * A closure is per (pile, drop), so closing a shared night would silently discharge the other
   * person's coupons too. Such a night is left open and said as a count instead.
   */
  shared: boolean;
};

/** One person, and everything of yours they have not handed over yet. */
export type Settlement = {
  key: string;
  name: string;
  /**
   * False when nobody has said who plays that character. Then this row is a CHARACTER and the same
   * human may appear twice under two names, which is said rather than guessed at.
   */
  attributed: boolean;
  /** Whose pile, for the payment, the entry and the closure this card writes. See holderFromKey. */
  holder: Holder;
  /**
   * Pieces of yours they hold, less any their own priced tranche has already answered for. Those
   * are money on this card instead, so counting them here too would ask twice for one debt.
   */
  pieces: number;
  /**
   * Pieces of THEIRS you hold, which is the same debt from the other end. Net of what a sale of
   * yours already answered for (priced into `soldOfTheirs`), the same subtraction the Sale Ledger
   * makes.
   */
  piecesYouOwe: number;
  /**
   * Pieces already answered with money, in each direction, and so NOT in the two counts above.
   * Taken off the nights as well, oldest first, so each list adds up to the count over it.
   */
  piecesAnswered: { yours: number; theirs: number };
  /**
   * The two above, netted: positive is coupons of theirs you hold, negative is yours they hold.
   *
   * Netting a COUNT is safe in a way netting a price is not: it is the same coupon on both sides and
   * the same person, so nothing is being valued.
   */
  piecesNet: number;
  /**
   * Mesos they owe you once every direction is netted off. Zero when the two sides cancel or you are
   * the one behind, and then `owedByYou` carries it instead.
   */
  mesos: number;
  /** Mesos YOU owe them, when the netting comes out that way. */
  owedByYou: number;
  /**
   * Unpaid shares YOU owe them, outside the net until you say which way they go. See V57 and V61.
   *
   * Offset takes it off what they owe you; Mark sent leaves their debt where it was. Subtracting it
   * on arrival would make Offset a button that changes nothing on screen.
   */
  sharesYouOwe: number;
  /**
   * Unpaid shares of a sale made in REAL MONEY, in cents, in both directions. Never netted against
   * anything above, because there is no rate in this app to net them at. Only ever shares: debts and
   * payments are meso rows (V56).
   *
   * `net` is not drawn: what you owe waits outside the headline, as in sharesYouOwe.
   */
  usd: Owings;
  /** What the net is made of, in the order the card says them. Every one is signed towards you. */
  parts: {
    /** Unpaid shares THEY owe you. What you owe them is `sharesYouOwe`, which is not netted here. */
    shares: number;
    /**
     * Entered by hand. Positive is what they owe you that no drop accounts for. Negative is a share
     * of YOURS discharged against theirs (V57).
     */
    entered: number;
    /**
     * Their coupons you sold, only as far as somebody has said the money comes off what they owe.
     * Negative. The rest is `holding`. See V61.
     */
    soldOfTheirs: number;
    /** What they owe for coupons of yours they kept, at the price you entered. Positive. */
    soldOfYours: number;
    /**
     * Your money they held from a sale of your coupons, AS FAR AS somebody has said it comes off what
     * you owe them. Positive. A discharge, so listed under offsets and never in the owed list, the
     * same as `soldOfTheirs`. The rest is `heldByThem`. See V91.
     */
    offsetOfYours: number;
    /**
     * Mesos that have arrived from them. Negative: a payment is a debt going away.
     *
     * All of it, even past what they owe: the excess is an overpayment and lands in `owedByYou`.
     * Never held apart to stand in for their unpriced coupons of yours; a coupon they sell is priced
     * by its sale (`heldByThem`). The receipts themselves are drawn by moneyRows.
     */
    received: number;
  };
  /**
   * Mesos of THEIRS you are holding from a sale of their coupons, undecided. See V61.
   *
   * Outside the net, and outside `owedByYou`, on purpose: it either comes off what they owe you or
   * you send it, and netting it on arrival would make that choice silently.
   */
  holding: number;
  /**
   * The sales that money came out of, oldest first, so a decision can name the coupons it was made
   * of. No figure on the card is derived from these. See CouponSale.
   */
  sales: CouponSale[];
  /**
   * Mesos of YOURS they are holding from a sale of your coupons out of their pile, undecided. `holding`
   * from the other end, outside the net for the same reason: it comes off what you owe them, or they
   * send it. See V91.
   */
  heldByThem: number;
  /** The sales behind `heldByThem`, oldest first. */
  salesHeldByThem: CouponSale[];
  /** What has been decided, either direction, so a wrong one can be taken back off. See V61. */
  disposals: ProceedsDisposal[];
  /** Drawn whatever it says, because somebody said to keep it. See V59. */
  pinned: boolean;
  /** The entered rows themselves, so a mistyped one can be taken back off the card. */
  entries: SettlementDebt[];
  /** Nights in THEIR pile holding coupons of yours. */
  drops: HeldOfYours[];
  /** Nights in YOUR pile holding coupons of theirs, the other half of the handover. See settleThePair. */
  owedDrops: HeldOfYours[];
  /**
   * `owedDrops` before any sale spent them, which is what says which week a sale of theirs came off.
   * See weekSplit.
   */
  owedNights: HeldOfYours[];
  lines: WalletLine[];
};

/** Each spent night with what the spend took off it. Same order in and out, see spendSales. */
function withSold(before: HeldOfYours[], after: HeldOfYours[]): HeldOfYours[] {
  return after.map((night, i) => ({ ...night, sold: before[i]!.pieces - night.pieces }));
}

const blank = (key: string, name: string): Settlement => ({
  key,
  name,
  attributed: key.startsWith("person:"),
  holder: holderFromKey(key),
  pieces: 0,
  piecesYouOwe: 0,
  piecesAnswered: { yours: 0, theirs: 0 },
  piecesNet: 0,
  mesos: 0,
  owedByYou: 0,
  sharesYouOwe: 0,
  usd: { owe: 0, owed: 0, net: 0 },
  parts: { shares: 0, entered: 0, soldOfTheirs: 0, soldOfYours: 0, offsetOfYours: 0, received: 0 },
  holding: 0,
  sales: [],
  heldByThem: 0,
  salesHeldByThem: [],
  disposals: [],
  pinned: false,
  entries: [],
  drops: [],
  owedDrops: [],
  owedNights: [],
  lines: [],
});

/**
 * One row per person who owes you something, from both ledgers at once.
 *
 * Keyed the way both sides already key a counterparty (`person:<id>` or `character:<name>`), so a
 * person who owes you pieces AND a share is one row rather than two.
 */
export function buildSettlement(
  ledgers: HolderLedger[],
  wallet: Wallet,
  /** Entered by hand, from V56. Rows rather than a total, so one can be taken back off. */
  debts: SettlementDebt[] = [],
  /** What sales of somebody else's coupons came to, per counterparty. See saleCredits. */
  credits: Map<string, SaleCredit> = new Map(),
  /**
   * Mesos received from each holder, keyed by holderKey. Not read off the HolderLedger: a person with
   * no open drop has no ledger, and their payment would be silently lost.
   */
  received: Map<string, number> = new Map(),
  /** What to call a key nothing else on this list can name. Party seats, folded to their people. */
  names: Map<string, string> = new Map(),
  /** People whose card is drawn whatever it says. See V59. */
  pinned: Set<string> = new Set(),
  /**
   * Pieces each (pile, creditor) pair has already answered for with money. See answeredByPair.
   * `credits` carries the mesos a priced tranche came to; this carries the pieces it spoke for.
   */
  answered: Map<string, AnsweredSale[]> = new Map(),
  /**
   * What has been decided about the money a sale of their coupons left in your hands. See V61.
   * Empty means nothing decided, not "offset".
   */
  disposals: ProceedsDisposal[] = [],
): Settlement[] {
  const out = new Map<string, Settlement>();
  const rowFor = (key: string, name?: string) => {
    const row = out.get(key) ?? blank(key, name ?? names.get(key) ?? key);
    out.set(key, row);
    return row;
  };

  // Pieces of theirs in YOUR pile, off your own ledger's transfers so it is the same subtraction the
  // party rows draw. Per person, because your pile owes each of them separately.
  for (const ledger of ledgers) {
    if (ledger.holder.kind !== "SELF" || ledger.closed) continue;
    for (const drop of ledger.drops) {
      if (drop.closed) continue;
      const owing = drop.transfers.filter((t) => t.toId !== SELF_KEY);
      for (const transfer of owing) {
        // Named off the transfer: a person you only owe coupons to reaches this list nowhere else.
        const row = rowFor(transfer.toId, transfer.to);
        row.piecesYouOwe += transfer.pieces;
        row.owedDrops.push({
          lootId: drop.lootId,
          partyId: drop.partyId,
          bossKey: drop.bossKey,
          weekStart: drop.weekStart,
          droppedOn: drop.droppedOn,
          recordedAt: drop.recordedAt,
          pieces: transfer.pieces,
          sold: 0,
          looterName: drop.looterName,
          ran: drop.ran,
          // A different PERSON, not merely a second transfer: one night can owe one person twice,
          // and that is still one drop, one closure and nobody else's coupons at stake.
          shared: owing.some((t) => t.toId !== transfer.toId),
        });
      }
    }
  }

  // Off each of those, the pieces a sale of yours already spoke for, or they would be asked for in
  // both units at once. Capped at what is owed, per person, so a mistyped tranche cannot spill onto
  // the next person's card. See V56.
  for (const [key, row] of out) {
    // The nights first, then the headline off what they actually absorbed, so the two always agree.
    // See spendSales.
    row.owedNights = row.owedDrops;
    const spent = withSold(
      row.owedDrops,
      spendSales(row.owedDrops, answered.get(answeredKey(SELF_KEY, key)) ?? []),
    );
    row.piecesAnswered.theirs = row.piecesYouOwe - spent.reduce((sum, d) => sum + d.pieces, 0);
    row.piecesYouOwe -= row.piecesAnswered.theirs;
    row.owedDrops = spent;
  }

  // The pieces. Your own pile is not a debt to you, and a closed one is finished.
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF" || ledger.closed) continue;
    // Only the drops still open, and only the part of each that is YOURS.
    const drops = ledger.drops
      .filter((d) => !d.closed)
      .map((d) => ({
        lootId: d.lootId,
        partyId: d.partyId,
        bossKey: d.bossKey,
        weekStart: d.weekStart,
        droppedOn: d.droppedOn,
        recordedAt: d.recordedAt,
        pieces: d.transfers
          .filter((t) => t.toId === SELF_KEY)
          .reduce((sum, t) => sum + t.pieces, 0),
        sold: 0,
        looterName: d.looterName,
        ran: d.ran,
        // Their pile owing a third person off the same night. See HeldOfYours.shared.
        shared: d.transfers.some((t) => t.toId !== SELF_KEY),
      }))
      .filter((d) => d.pieces > 0);
    if (drops.length === 0) continue;

    const row = rowFor(holderKey(ledger.holder), ledger.holderName);
    // The mirror of the subtraction above: coupons of yours THEY sold. `heldByThem` (or
    // `soldOfYours`, for a keep) carries the money.
    const spent = withSold(
      drops,
      spendSales(drops, answered.get(answeredKey(holderKey(ledger.holder), SELF_KEY)) ?? []),
    );
    row.piecesAnswered.yours = ledger.owedToYou - spent.reduce((sum, d) => sum + d.pieces, 0);
    row.pieces = ledger.owedToYou - row.piecesAnswered.yours;
    row.drops = spent;
  }

  // The shares, one direction each. What they owe you is in the net; what YOU owe stays outside it
  // until Offset or Mark sent says which way it goes. See sharesYouOwe and V61.
  for (const person of wallet.counterparties) {
    if (person.lines.length === 0) continue;
    const row = rowFor(person.key, person.name);
    row.parts.shares = person.owed;
    row.sharesYouOwe = person.owe;
    row.usd = person.usd;

    // Every line, both directions, whichever way the net runs: one transfer of the difference marks
    // both sides paid, and this card is the only place a share you owe can be settled.
    row.lines = person.lines;
  }

  // Entered by hand. See V56.
  for (const debt of debts) {
    const row = rowFor(holderKey(debt.holder));
    row.parts.entered += debt.amount;
    row.entries.push(debt);
  }

  // Coupons of somebody else's, sold at a typed price: money of theirs in your hands. It lands in
  // `holding`, not the net, until the pair decides (V61). Your coupons sold out of their pile are
  // held the same way in their hands (V91).
  for (const [key, credit] of credits) {
    const row = rowFor(key);
    row.holding += credit.toThem;
    row.sales.push(...credit.sales);
    row.heldByThem += credit.toYou;
    row.salesHeldByThem.push(...(credit.salesToYou ?? []));
    row.parts.soldOfYours += credit.keptByThem ?? 0;
  }

  // What has been decided about it. An OFFSET moves out of `holding` and into the net. A payment out
  // leaves both: the money went to them and their debt never moved. Capped at what is held. Money of
  // yours THEY hold runs the same way round.
  for (const disposal of disposals) {
    const row = rowFor(holderKey(disposal.holder));
    row.disposals.push(disposal);
    if (heldByThem(disposal)) {
      const spent = Math.min(row.heldByThem, disposal.amount);
      row.heldByThem -= spent;
      if (disposal.kind === "OFFSET") row.parts.offsetOfYours += spent;
      continue;
    }
    const spent = Math.min(row.holding, disposal.amount);
    row.holding -= spent;
    if (disposal.kind === "OFFSET") row.parts.soldOfTheirs -= spent;
  }

  for (const [key, paid] of received) {
    if (key === SELF_KEY || paid === 0) continue;
    rowFor(key).parts.received -= paid;
  }

  for (const row of out.values()) {
    const net = Object.values(row.parts).reduce((sum, part) => sum + part, 0);
    row.mesos = Math.max(0, net);
    row.owedByYou = Math.max(0, -net);
  }

  // A pinned person gets a row even with nothing on it: it is where next week's entry goes.
  for (const key of pinned) rowFor(key).pinned = true;

  for (const row of out.values()) {
    // The COUNTS cancel, because one handover settles the pair. The nights do NOT, so a week filter
    // shows the gross and not whatever the netting left.
    const wash = Math.min(row.pieces, row.piecesYouOwe);
    row.pieces -= wash;
    row.piecesYouOwe -= wash;
    row.piecesNet = row.piecesYouOwe - row.pieces;
  }

  return [...out.values()]
    .filter(
      (row) =>
        row.pinned ||
        row.mesos > 0 ||
        row.owedByYou > 0 ||
        // Each of these is outside the net and can be the only thing on a card. Dropping the card
        // would leave it nowhere to be settled.
        row.sharesYouOwe > 0 ||
        row.usd.owed > 0 ||
        row.usd.owe > 0 ||
        row.pieces > 0 ||
        row.piecesYouOwe > 0 ||
        row.holding > 0 ||
        row.heldByThem > 0,
    )
    .sort(
      (a, b) =>
        b.mesos - a.mesos ||
        b.owedByYou + b.sharesYouOwe - (a.owedByYou + a.sharesYouOwe) ||
        // Its own key, never added to the mesos. See buildWallet's sort.
        b.usd.owed - a.usd.owed ||
        b.pieces - a.pieces ||
        b.piecesYouOwe - a.piecesYouOwe ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The purchases somebody else's pile has recorded against YOUR coupons, per holder.
 *
 * Correctable only on their card, since the Sale Ledger draws your own piles alone. Keyed by
 * holderKey.
 */
export function keptOfYours<T extends { holder: Holder; shares?: { holder: Holder }[] }>(
  tranches: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const tranche of tranches) {
    const pile = holderKey(tranche.holder);
    if (pile === SELF_KEY) continue;
    if (!(tranche.shares ?? []).some((s) => holderKey(s.holder) === SELF_KEY)) continue;
    const seen = out.get(pile);
    if (seen) seen.push(tranche);
    else out.set(pile, [tranche]);
  }
  return out;
}

/** One act that has already come off what they owe you. See V57, V58 and V61. */
export type Discharge = {
  id: string;
  /**
   * Which ledger it lives in, because taking it back goes to a different place. DEBT is an offset
   * entry, PROCEEDS a decision about held sale money, PAYMENT mesos actually sent.
   */
  source: "DEBT" | "PROCEEDS" | "PAYMENT";
  /** Mesos it took off. POSITIVE, so a list of them adds up to what has come off. */
  amount: number;
  label: string;
  at: string;
  /** The shares it discharged, where it names any. Empty on a typed credit and on a disposal. */
  payouts: SettlementDebtPayout[];
  /**
   * The coupon sales it was made of. Empty on everything but a decision, and on a decision whose
   * sales cannot be told: see couponSalesBehind.
   */
  sales: CouponSale[];
  /** Who wrote it, when the other side of a shared book did: theirs to take back, not yours. V88. */
  by?: string | null;
};

/**
 * Which coupon sales each decision about their money was made of.
 *
 * A decision names no tranche. It is taken on the whole undecided pile at once, so which sales that
 * was is worked out by spending them in the same order buildSettlement spends the money: both lists
 * arrive oldest first, and each decision takes off the front of what is left.
 *
 * WHOLE SALES, and the run has to land exactly on the amount: part of a sale cannot say which coupons
 * it was. Where the alignment breaks, that decision and every later one get nothing, so their rows
 * say a figure and make no claim about its parts.
 */
function couponSalesBehind(
  sales: CouponSale[],
  disposals: ProceedsDisposal[],
): Map<string, CouponSale[]> {
  const out = new Map<string, CouponSale[]>();
  let next = 0;
  for (const disposal of disposals) {
    const taken: CouponSale[] = [];
    let sum = 0;
    while (sum < disposal.amount && next < sales.length) {
      const sale = sales[next]!;
      sum += sale.mesos;
      taken.push(sale);
      next += 1;
    }
    if (sum !== disposal.amount) break;
    out.set(disposal.id, taken);
  }
  return out;
}

/**
 * Which sales somebody has said what happens to the money of, and who for.
 *
 * The Sale Ledger's fold. A sale of somebody's coupons is finished once its money has been paid out
 * or taken off what they owe you.
 *
 * The SAME match the discharge rows are drawn from, so the pill and the act cannot name different
 * sales. A decision whose sales cannot be told exactly leaves the pill on screen.
 *
 * Off the credits rather than the built cards: paying somebody out in full drops their card from the
 * list, so a sale read off the rows would flip back to undecided the moment it was finished.
 *
 * Per creditor, because one sale can hold two people's coupons and each decides separately.
 */
export function decidedSales(
  credits: Map<string, SaleCredit>,
  disposals: ProceedsDisposal[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [key, credit] of credits) {
    // Their own decisions, in the order buildSettlement spends them. Two people's decisions never
    // queue against one another's money.
    const theirs = disposals.filter((d) => holderKey(d.holder) === key);
    const decide = (sales: CouponSale[], by: ProceedsDisposal[], creditor: string) => {
      for (const taken of couponSalesBehind(sales, by).values()) {
        for (const sale of taken) {
          const creditors = out.get(sale.trancheId) ?? new Set<string>();
          creditors.add(creditor);
          out.set(sale.trancheId, creditors);
        }
      }
    };
    // Your pile's sales of their coupons, and theirs of yours, each spent by its own direction's
    // decisions. The creditor of the second is you.
    decide(
      credit.sales,
      theirs.filter((d) => !heldByThem(d)),
      key,
    );
    decide(credit.salesToYou ?? [], theirs.filter(heldByThem), SELF_KEY);
  }
  return out;
}

/** Whether a decision is about money of yours they hold, rather than theirs you hold. See V91. */
export function heldByThem(disposal: ProceedsDisposal): boolean {
  return disposal.heldBy === "THEM";
}

/**
 * The coupon sales the money you are still holding came out of, or none where they cannot be told.
 *
 * couponSalesBehind from the other end: decisions take the oldest sales first, so what is left is the
 * tail, and it sums to `holding` exactly.
 *
 * Read off `holding` rather than the disposals, whose amounts are capped as they are applied: adding
 * the rows up would spend sales nothing paid for.
 *
 * WHOLE SALES only. Where a decision stopped mid-sale this returns empty, so the card says the figure
 * and nothing about its parts.
 */
export function undecidedSales(row: Pick<Settlement, "sales" | "holding">): CouponSale[] {
  const credited = row.sales.reduce((sum, sale) => sum + sale.mesos, 0);
  const decided = credited - row.holding;
  let spent = 0;
  let next = 0;
  while (spent < decided && next < row.sales.length) {
    spent += row.sales[next]!.mesos;
    next += 1;
  }
  if (spent !== decided) return [];
  return row.sales.slice(next);
}

/** The other side of a shared book, when they wrote this row; null when you did. See V88. */
function writerOf(row: WrittenBy): string | null {
  return row.recordedByYou === false ? (row.recordedByName ?? "") : null;
}

/**
 * The money rows split by what they ARE: typed debts, and the dated, removable acts that came off
 * them (offsets, decisions to offset held sale money, and payments, each receipt its own row).
 */
export function moneyRows(
  row: Settlement,
  received: ({
    id: string;
    amount: number;
    note: string | null;
    receivedAt: string;
  } & WrittenBy)[] = [],
): {
  /** Debts somebody typed, in the order they were entered. */
  typed: SettlementDebt[];
  /** Every act that came off, newest first: the half worth folding is the half that grows. */
  discharges: Discharge[];
  /** What those acts come to. Positive. */
  discharged: number;
} {
  const typed: SettlementDebt[] = [];
  const discharges: Discharge[] = [];

  for (const entry of row.entries) {
    // Either sign. A negative one is them saying you owe them (V88), which is a debt and not
    // something that came off one. Only an offset names the shares it discharged.
    if (entry.payouts.length === 0) {
      typed.push(entry);
      continue;
    }
    discharges.push({
      id: entry.id,
      source: "DEBT",
      amount: Math.abs(entry.amount),
      label: entry.note ?? "offset",
      at: entry.incurredAt,
      payouts: entry.payouts,
      sales: [],
      by: writerOf(entry),
    });
  }

  // Matched against every decision, not just offsets: a payment out spent sales too. Each direction
  // is its own pile of money, matched against its own sales.
  const behind = new Map([
    ...couponSalesBehind(
      row.sales,
      row.disposals.filter((d) => !heldByThem(d)),
    ),
    ...couponSalesBehind(row.salesHeldByThem, row.disposals.filter(heldByThem)),
  ]);

  // Only offsets: a payment out left what they owe you where it was. An offset of money THEY hold
  // came off what you owe them, so it is signed the way a payment of yours is (V89).
  for (const disposal of row.disposals) {
    if (disposal.kind !== "OFFSET") continue;
    discharges.push({
      id: disposal.id,
      source: "PROCEEDS",
      amount: heldByThem(disposal) ? -disposal.amount : disposal.amount,
      label: "coupon sale",
      at: disposal.decidedAt,
      payouts: [],
      sales: behind.get(disposal.id) ?? [],
      by: writerOf(disposal),
    });
  }

  for (const got of received) {
    discharges.push({
      id: got.id,
      source: "PAYMENT",
      // Signed (V89): negative is you paying them, which puts back on their side what it took off yours.
      amount: got.amount,
      label: got.note ?? (got.amount < 0 ? "you paid" : "paid"),
      at: got.receivedAt,
      payouts: [],
      sales: [],
      by: writerOf(got),
    });
  }

  discharges.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    typed,
    discharges,
    discharged: discharges.reduce((sum, d) => sum + d.amount, 0),
  };
}

/** What closing the coupon books with one person would cover, in nights. See settleThePair. */
export type PairSettlement = {
  /** Nights in their pile it closes: coupons of yours they were holding. */
  theirs: string[];
  /** Nights in your own pile it closes: coupons of theirs you were holding. */
  yours: string[];
  /**
   * Nights left open because the same night owes somebody else. Not drawn (each night says so on its
   * own row), but kept so a reader can tell a short list from a complete one.
   */
  shared: number;
  /**
   * Whether there is anything for one handover to close: coupons still outstanding either way.
   * Deliberately no count of nights here: the nights are listed beside the button already.
   */
  offered: boolean;
};

/**
 * The nights one handover between you and this person finishes, in BOTH directions.
 *
 * Close the pair or close nothing: closing one side alone takes the other side's coupons out of the
 * netting and puts the figure UP.
 *
 * A night that owes a THIRD person is left out and counted instead. See HeldOfYours.shared.
 */
export function settleThePair(row: Settlement): PairSettlement {
  const theirs = row.drops.filter((d) => !d.shared);
  // One night can owe them twice, off two transfers, and it is one drop and one closure.
  const yours = [...new Set(row.owedDrops.filter((d) => !d.shared).map((d) => d.lootId))];
  const shared =
    row.drops.filter((d) => d.shared).length +
    new Set(row.owedDrops.filter((d) => d.shared).map((d) => d.lootId)).size;
  const lootIds = theirs.map((d) => d.lootId);
  return {
    theirs: lootIds,
    yours,
    shared,
    // Square books offer nothing. Zero-piece nights ride along when it is offered.
    offered: lootIds.length + yours.length > 0 && (row.pieces > 0 || row.piecesYouOwe > 0),
  };
}

/**
 * The payout rows that settling this card's SHARES would mark paid.
 *
 * The pieces are not in here and must not be: they have no payout row, so naming one would clear
 * nothing while looking as though it had.
 */
export function sharesOf(row: Settlement): { lootId: string; memberId: string }[] {
  return row.lines.map((line) => ({ lootId: line.lootId, memberId: line.payeeId }));
}

/**
 * One share an offset discharged, resolved for the card.
 *
 * Built from the pools rather than the card, because an offset share is PAID and has left the
 * wallet. See V58.
 */
export type OffsetShare = {
  key: string;
  /** The drop itself, which is what the row opens: its own history, not its party's. */
  lootId: string;
  /** The seat the share belongs to, so a resolved share can name its own payout row again. */
  memberId: string;
  /** What fell. */
  item: string;
  iconUrl: string | null;
  boss: string;
  /** Who was in that night, not who the share belonged to. */
  members: string[];
  /** The day it dropped, so two nights on one boss are told apart. */
  on: string;
  /** The bossing week it FELL in, never the week it sold or was offset. Empty on a deleted drop. */
  weekStart: string;
  /** This seat's share, which is the money the offset actually discharged. */
  share: number;
  /** What the whole lot sold for, so the share can be checked against it. Null if never sold. */
  sale: number | null;
  /** The unit `share` and `sale` are both in. Cents when USD. See lib/money.ts. */
  currency: Currency;
  partyId: string;
};

/**
 * The entries written as one row over several shares, with the rows each should have been.
 *
 * Entries from before #514 name several drops under one figure. The parts are recoverable from the
 * stored payouts (V58), each share being `splitOf` over the drop's own party.
 *
 * REFUSED unless they add up to the entry EXACTLY: a moved roster or a deleted night gives shares
 * that no longer reconstruct the act.
 *
 * Also refused where another entry ALREADY names one of the shares. That is a split whose rows
 * landed and whose delete did not, and splitting it again would write more rows on every load.
 *
 * Off the stored debts rather than the built rows, because this decides a WRITE.
 */
export function splittableDebts(
  debts: SettlementDebt[],
  offsetShares: Map<string, OffsetShare>,
): { debt: SettlementDebt; parts: OffsetPart[] }[] {
  // How many entries name each share. Anything above one is a ledger mid-repair.
  const claims = new Map<string, number>();
  for (const debt of debts) {
    for (const payout of debt.payouts) {
      const key = shareKey(payout.lootId, payout.memberId);
      claims.set(key, (claims.get(key) ?? 0) + 1);
    }
  }

  const out: { debt: SettlementDebt; parts: OffsetPart[] }[] = [];
  for (const debt of debts) {
    // An offset is negative, and covers more than one share only if it was written before #514.
    if (debt.amount >= 0 || debt.payouts.length < 2) continue;
    const parts: OffsetPart[] = [];
    let refused = false;
    for (const payout of debt.payouts) {
      const key = shareKey(payout.lootId, payout.memberId);
      const share = offsetShares.get(key);
      // Unresolved is a deleted drop or a pool not yet loaded. A partial split would drop the rest.
      if (!share || (claims.get(key) ?? 0) > 1) {
        refused = true;
        break;
      }
      parts.push({ lootId: payout.lootId, memberId: payout.memberId, amount: share.share });
    }
    if (refused) continue;
    if (parts.reduce((sum, part) => sum + part.amount, 0) !== -debt.amount) continue;
    out.push({ debt, parts });
  }
  return out;
}

/** How a resolved share is keyed. One drop owes several people, so both halves are needed. */
export function shareKey(lootId: string, memberId: string): string {
  return `${lootId}:${memberId}`;
}

/** What the whole list comes to, in mesos and in dollars. */
export type SettlementTotals = {
  owed: number;
  owe: number;
  net: number;
  people: number;
  /** The same pair in cents, off dollar sales. Its own tile, never added to the mesos. See Owings. */
  usd: Owings;
};

/**
 * The account's position, summed off the CARDS rather than worked out again.
 *
 * The same rows the list draws, so a tile cannot disagree with the cards under it. The pieces are
 * not in it: a count cannot be added to a total of mesos.
 */
export function settlementTotals(rows: Settlement[]): SettlementTotals {
  const owed = rows.reduce((sum, row) => sum + row.mesos, 0);
  // Shares of yours are outside the net, so they are added here or the tile would be short.
  const owe = rows.reduce((sum, row) => sum + row.owedByYou + row.sharesYouOwe, 0);
  const usdOwed = rows.reduce((sum, row) => sum + row.usd.owed, 0);
  const usdOwe = rows.reduce((sum, row) => sum + row.usd.owe, 0);
  return {
    owed,
    owe,
    net: owed - owe,
    people: rows.length,
    usd: { owed: usdOwed, owe: usdOwe, net: usdOwed - usdOwe },
  };
}

/**
 * The payout rows for the shares YOU owe, which is what "Mark Sent" and "Offset" both act on.
 *
 * Not sharesOf, which is every line: on a card running both ways that would mark what THEY owe you
 * paid at the same time, and say you had collected money nobody has sent.
 */
export function owedByYouShares(row: Settlement): { lootId: string; memberId: string }[] {
  return row.lines
    .filter((line) => line.direction === "owe")
    .map((line) => ({ lootId: line.lootId, memberId: line.payeeId }));
}

/** One share an offset will discharge, and the row it will be recorded as. See V57. */
export type OffsetPart = {
  lootId: string;
  memberId: string;
  /** This seat's share, pre-fee, which is the figure its own ledger row carries. */
  amount: number;
};

/** What discharging the shares you owe against what they owe you would come to. See V57. */
export type Offset = {
  /**
   * The shares it discharges. The act covers all of them or none, but it is RECORDED one row per
   * share, so one can be taken back without the others.
   */
  parts: OffsetPart[];
  /** Mesos of shares it discharges, which is all of them or none. Sums `parts`. */
  amount: number;
  /** What it has to come off: everything on their side EXCEPT the shares it discharges. */
  toComeOff: number;
  /** What their debt cannot cover, and so leaves you owing. Zero when it covers the lot. */
  leftOwing: number;
  /**
   * Whether the act is offered: shares of yours and a debt of theirs to come off. The debt need not
   * cover the lot; the rest is left owing.
   */
  offered: boolean;
};

/**
 * What an offset would do to this card, in the figures the button has to say before it runs.
 *
 * Whole shares only, since a payout row is paid or it is not. Where the debt cannot cover them the
 * remainder stays yours in mesos.
 */
export function offsetOf(row: Settlement): Offset {
  // MESO SHARES ONLY. An offset writes into settlement_debt (V57), a meso ledger, and there is no
  // rate to convert a dollar share at. Marking a dollar share sent still works.
  const parts: OffsetPart[] = row.lines
    .filter((line) => line.direction === "owe" && line.currency === "MESO")
    .map((line) => ({ lootId: line.lootId, memberId: line.payeeId, amount: line.pay }));
  // Off the parts, never alongside them, so the rows always add up to the total.
  const amount = parts.reduce((sum, part) => sum + part.amount, 0);
  // Their side, whole: the shares being discharged are no longer inside it, so nothing is added back.
  const toComeOff = row.mesos - row.owedByYou;
  return {
    parts,
    amount,
    toComeOff,
    leftOwing: Math.max(0, amount - toComeOff),
    offered: amount > 0 && toComeOff > 0,
  };
}

/** Who sends the mesos a closing act moves, from the card's own side. */
export type NetPayer = "YOU" | "THEM" | null;

/** One share a closing act settles. Its unit says whether an Offset can take it (mesos only). */
export type ClosingShare = OffsetPart & { currency: string };

/**
 * Everything one closing act settles between the pair, netted, and who pays.
 *
 * Every button in Closing Actions on both cards reads this and nothing else, so the payer's Mark
 * Sent, the payee's Mark Received and listing, and the even pair's Mark Settled cannot disagree
 * (Jonathan, 2026-10-25). Four meso pots net: shares each way and coupon money held each way.
 * Entered debts stay out, settled by a payment or taken by an Offset. Dollars never net.
 */
export type ClosingNet = {
  /** Mesos that cross, after netting. Zero when the pair is even. */
  mesos: number;
  /** Who sends them. Null when even. */
  payer: NetPayer;
  /** Every share you owe, mesos and dollars. One press marks them all paid. */
  sharesYouOwe: ClosingShare[];
  /** Every share they owe you, mesos and dollars. */
  sharesTheyOwe: ClosingShare[];
  /** Their coupon money you hold. */
  holding: number;
  /** Your coupon money they hold. */
  heldByThem: number;
  /** Cents of dollar shares each way, closed by the same press and named beside the mesos. */
  usdYouOwe: number;
  usdTheyOwe: number;
  /**
   * The entered balance an Offset takes the mesos off instead of their crossing: positive is what
   * they owe you outside the four pots. See offsetAgainst on the cards.
   */
  enteredBalance: number;
  /** Whether there is anything for a closing act to settle. */
  open: boolean;
};

/** Off the shares, never alongside them, so the parts always add up to what they say. */
const sharesRunning = (row: Settlement, direction: "owe" | "owed"): ClosingShare[] =>
  row.lines
    .filter((line) => line.direction === direction)
    .map((line) => ({
      lootId: line.lootId,
      memberId: line.payeeId,
      amount: line.pay,
      currency: line.currency,
    }));

const mesosOf = (row: Settlement, direction: "owe" | "owed") =>
  row.lines
    .filter((line) => line.direction === direction && line.currency === "MESO")
    .reduce((sum, line) => sum + line.pay, 0);

const centsOf = (row: Settlement, direction: "owe" | "owed") =>
  row.lines
    .filter((line) => line.direction === direction && line.currency === "USD")
    .reduce((sum, line) => sum + line.pay, 0);

/** [net] read from the other end: what the member's card draws from the owner's row. */
export function flipNet(net: ClosingNet): ClosingNet {
  return {
    mesos: net.mesos,
    payer: net.payer === "YOU" ? "THEM" : net.payer === "THEM" ? "YOU" : null,
    sharesYouOwe: net.sharesTheyOwe,
    sharesTheyOwe: net.sharesYouOwe,
    holding: net.heldByThem,
    heldByThem: net.holding,
    usdYouOwe: net.usdTheyOwe,
    usdTheyOwe: net.usdYouOwe,
    enteredBalance: -net.enteredBalance,
    open: net.open,
  };
}

/** What one closing act settles on this card, and which way the mesos go. See ClosingNet. */
export function closingNet(row: Settlement): ClosingNet {
  const signed = mesosOf(row, "owe") + row.holding - row.heldByThem - mesosOf(row, "owed");
  const sharesYouOwe = sharesRunning(row, "owe");
  const sharesTheyOwe = sharesRunning(row, "owed");
  // Their side whole, less the shares this act closes: what an Offset has to come off.
  const theirSide = Object.values(row.parts).reduce((sum, part) => sum + part, 0);
  return {
    mesos: Math.abs(signed),
    payer: signed > 0 ? "YOU" : signed < 0 ? "THEM" : null,
    sharesYouOwe,
    sharesTheyOwe,
    holding: row.holding,
    heldByThem: row.heldByThem,
    usdYouOwe: centsOf(row, "owe"),
    usdTheyOwe: centsOf(row, "owed"),
    enteredBalance: theirSide - row.parts.shares,
    open:
      sharesYouOwe.length > 0 || sharesTheyOwe.length > 0 || row.holding > 0 || row.heldByThem > 0,
  };
}

/** Nothing stands between you either way. */
export function isEmpty(row: Settlement): boolean {
  return (
    row.pieces === 0 &&
    row.piecesYouOwe === 0 &&
    row.mesos === 0 &&
    row.owedByYou === 0 &&
    row.sharesYouOwe === 0 &&
    row.usd.owed === 0 &&
    row.usd.owe === 0
  );
}

/**
 * The piles the Sale Ledger draws, which is yours: the only ones you can sell out of. What others owe
 * is the Settlement Ledger's alone to say.
 */
export function yourPiles<T extends { holder: Holder }>(ledgers: T[]): T[] {
  return ledgers.filter((ledger) => ledger.holder.kind === "SELF");
}

/**
 * A sale's money divided over the weeks its pieces came from, by pieces, the odd meso on the last
 * (latest) week so the parts always add up to the sale.
 */
function mesosByWeek(sale: CouponSale, pieces: Map<string, number>): Map<string, number> {
  const ordered = [...pieces].sort(([a], [b]) => a.localeCompare(b));
  const out = new Map<string, number>();
  let left = sale.mesos;
  ordered.forEach(([week, p], i) => {
    const part = i === ordered.length - 1 ? left : Math.floor((sale.mesos * p) / sale.pieces);
    left -= part;
    out.set(week, part);
  });
  return out;
}

/**
 * What one act discharged, by the bossing week the drops behind it fell in. Null where no week can be
 * told, which is a typed credit, a payment, a sale the nights cannot cover, or a night since deleted.
 *
 * NEVER the week it was sold or offset. A share names its drop, so its week is fact. A sale of
 * coupons names none, and is placed by the same newest-first spend that draws the nights it answered
 * (see placeSales), its money divided over the weeks by pieces with the odd meso on the last, so a
 * sale's weeks always add up to the sale.
 */
export function weekSplit(
  row: Pick<Settlement, "sales" | "owedNights">,
  act: Pick<Discharge, "amount" | "payouts" | "sales">,
  shares: { weekStart: string; share: number }[],
): Map<string, number> | null {
  if (act.payouts.length > 0) {
    if (shares.some((n) => n.weekStart === "")) return null;
    const weeks = new Set(shares.map((n) => n.weekStart));
    if (weeks.size === 1) return new Map([[[...weeks][0]!, act.amount]]);
    if (shares.reduce((sum, n) => sum + n.share, 0) !== act.amount) return null;
    const out = new Map<string, number>();
    for (const n of shares) out.set(n.weekStart, (out.get(n.weekStart) ?? 0) + n.share);
    return out;
  }
  if (act.sales.length === 0) return null;

  const wrapped = row.sales.map((sale) => ({
    sale,
    pieces: sale.pieces,
    recordedAt: sale.soldAt ?? "",
  }));
  const placed = placeSales(row.owedNights, wrapped);
  const out = new Map<string, number>();
  for (const sale of act.sales) {
    const w = wrapped.find((x) => x.sale === sale);
    const weeks = w ? placed.get(w) : null;
    if (!weeks) return null;
    for (const [week, part] of mesosByWeek(sale, weeks)) {
      out.set(week, (out.get(week) ?? 0) + part);
    }
  }
  return out;
}

/**
 * The bosses each coupon sale of theirs came off, biggest first, or null where the nights cannot
 * cover it. The same newest-first placement as weekSplit, so the bosses named are the nights the card
 * already draws as answered.
 */
export function bossesOfSales(
  row: Pick<Settlement, "sales" | "owedNights">,
): Map<CouponSale, { bossKey: string | null; partyId: string; pieces: number }[] | null> {
  const wrapped = row.sales.map((sale) => ({
    sale,
    pieces: sale.pieces,
    recordedAt: sale.soldAt ?? "",
  }));
  const out = new Map<
    CouponSale,
    { bossKey: string | null; partyId: string; pieces: number }[] | null
  >();
  for (const [w, taken] of placeSalesOnNights(row.owedNights, wrapped)) {
    if (taken === null) {
      out.set(w.sale, null);
      continue;
    }
    const by = new Map<string, { bossKey: string | null; partyId: string; pieces: number }>();
    for (const { night, pieces } of taken) {
      const key = `${night.bossKey}:${night.partyId}`;
      const seen = by.get(key) ?? { bossKey: night.bossKey, partyId: night.partyId, pieces: 0 };
      seen.pieces += pieces;
      by.set(key, seen);
    }
    out.set(
      w.sale,
      [...by.values()].sort((a, b) => b.pieces - a.pieces),
    );
  }
  return out;
}

type BossShare = { bossKey: string | null; partyId: string; pieces: number };

/** One night a coupon sale came off, and how many of its coupons. */
export type SaleNight = { night: HeldOfYours; pieces: number };

/**
 * The nights each coupon sale of theirs came off, or null where the nights cannot cover it. The same
 * placement weekSplit and the drawn nights use, so a row cannot name a night the card did not spend.
 */
export function nightsOfSales(
  row: Pick<Settlement, "sales" | "owedNights">,
): Map<CouponSale, SaleNight[] | null> {
  const wrapped = row.sales.map((sale) => ({
    sale,
    pieces: sale.pieces,
    recordedAt: sale.soldAt ?? "",
  }));
  const out = new Map<CouponSale, SaleNight[] | null>();
  for (const [w, taken] of placeSalesOnNights(row.owedNights, wrapped)) out.set(w.sale, taken);
  return out;
}

/**
 * One act as it reads under a single bossing week: only the sales and nights from that week, with
 * the amount, pieces and bosses of that week's part.
 *
 * The sales' money is divided exactly as weekSplit divides it, so the parts shown under every week
 * add up to the act. Null where the act has no week to slice by (a typed credit, a payment, a sale
 * the nights cannot cover), and the caller then draws it as it is.
 */
export function sliceActToWeek<N extends { weekStart: string; share: number }>(
  row: Pick<Settlement, "sales" | "owedNights">,
  act: Discharge,
  held: N[],
  week: string,
): {
  act: Discharge;
  shares: N[];
  bosses: Map<CouponSale, BossShare[]>;
  /** Each slice's nights in this week alone. */
  saleNights: Map<CouponSale, SaleNight[]>;
} | null {
  const split = weekSplit(row, act, held);
  const amount = split?.get(week);
  if (!split || amount === undefined) return null;

  if (act.payouts.length > 0) {
    const inWeek = held.filter((n) => n.weekStart === week);
    return {
      act: { ...act, amount, payouts: act.payouts.filter((_, i) => held[i]?.weekStart === week) },
      shares: inWeek,
      bosses: new Map(),
      saleNights: new Map(),
    };
  }

  const wrapped = row.sales.map((sale) => ({
    sale,
    pieces: sale.pieces,
    recordedAt: sale.soldAt ?? "",
  }));
  const placed = new Map<CouponSale, { night: HeldOfYours; pieces: number }[] | null>();
  for (const [w, taken] of placeSalesOnNights(row.owedNights, wrapped)) placed.set(w.sale, taken);

  const sales: CouponSale[] = [];
  const bosses = new Map<CouponSale, BossShare[]>();
  const saleNights = new Map<CouponSale, SaleNight[]>();
  for (const sale of act.sales) {
    const taken = placed.get(sale);
    if (!taken) return null;
    const weekPieces = new Map<string, number>();
    for (const { night, pieces } of taken) {
      weekPieces.set(night.weekStart, (weekPieces.get(night.weekStart) ?? 0) + pieces);
    }
    const pieces = weekPieces.get(week);
    if (!pieces) continue;
    const slice: CouponSale = { ...sale, pieces, mesos: mesosByWeek(sale, weekPieces).get(week)! };
    const by = new Map<string, BossShare>();
    for (const { night, pieces: p } of taken) {
      if (night.weekStart !== week) continue;
      const key = `${night.bossKey}:${night.partyId}`;
      const seen = by.get(key) ?? { bossKey: night.bossKey, partyId: night.partyId, pieces: 0 };
      seen.pieces += p;
      by.set(key, seen);
    }
    sales.push(slice);
    saleNights.set(
      slice,
      taken.filter(({ night }) => night.weekStart === week),
    );
    bosses.set(
      slice,
      [...by.values()].sort((a, b) => b.pieces - a.pieces),
    );
  }
  return { act: { ...act, amount, sales }, shares: held, bosses, saleNights };
}
