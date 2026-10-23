import { bossLabel } from "@/lib/boss-difficulty";
import { moneyRows, type SettlementTotals, undecidedSales } from "@/lib/settlement";
import { settlementView } from "@/lib/settlement-view";
import { paymentsSinceClosing } from "@/lib/vestige-ledger";
import type { CouponSale } from "@/lib/vestige-ledger";
import type { Owings, WalletLine } from "@/lib/wallet";
import type { Boss } from "@/types/boss";
import type { SharedBook } from "@/types/page";

/** Your card in somebody else's book, from your side. Every figure is theirs, swapped. */
export type SharedCard = {
  name: string;
  /** The owner's Discord avatar. */
  image: string | null;
  /** Your person row in their book: where your writes into it go (/api/shared-books/{personId}). */
  personId: string;
  /** Mesos they owe you: what their card says they owe you, netted or as unpaid shares. */
  owed: number;
  /** Mesos you owe them. */
  owe: number;
  /** Money of yours they are holding from a sale of your coupons, with nothing decided yet. */
  holding: number;
  /** Money of THEIRS you are holding from your sale of their coupons, undecided. See V91. */
  youHold: number;
  /** The sales behind `youHold`, oldest first, or none where they cannot be told exactly. */
  youHoldSales: CouponSale[];
  /** The sales behind `holding`, the same way: their sales of your coupons, money undecided. */
  holdingSales: CouponSale[];
  /** Your coupons in their inventory, and theirs in yours, after the counts wash. */
  piecesOwed: number;
  piecesOwe: number;
  usd: Owings;
  detail: SharedDetail;
};

/** One row of a detail list: what it was, and its mesos. */
export type SharedPart = {
  key: string;
  label: string;
  mesos: number;
  /** Who wrote it, when it was the owner and not you. See V88. */
  by?: string | null;
  /** A row you wrote, which you may take back: which list, and its id. */
  remove?: { kind: "debts" | "payments" | "disposals"; id: string };
  /** A share of a drop you sold, still unsent: the payout to mark. */
  send?: { partyId: string; lootId: string; payeeId: string };
  /** The drop's art, on a share row. */
  iconUrl?: string | null;
};

/**
 * What your card in their book is made of, from your side. Read-only: every figure is one the
 * owner's own card shows, under the label turned round, and nothing here is worked out again.
 */
export type SharedDetail = {
  /** What you owe them before anything came off: your shares, their coupons you sold, entered debts. */
  owe: SharedPart[];
  oweTotal: number;
  /** What has come off it, newest first: payments of yours, and offsets. */
  paid: SharedPart[];
  paidTotal: number;
  /** Shares of a night they owe you, one per drop. */
  theyOwe: WalletLine[];
  /** Debts entered their way: what they owe you outside a drop. Positive. */
  theyOweEntered: SharedPart[];
  /** Your money they are holding from a sale of your coupons, with nothing decided yet. */
  holding: number;
};

/**
 * Runs the owner's own arithmetic over their book and reads your row back from your side.
 *
 * The same settlementView their Settlement page calls, so the two cards cannot disagree about what
 * changes hands. Null when the book says nothing about you.
 */
export function sharedCard(book: SharedBook, bosses: Boss[]): SharedCard | null {
  const { settlement } = settlementView({
    ...book,
    bosses,
    people: [
      {
        id: book.personId,
        name: book.ownerName,
        characters: [],
        ownedCharacters: [],
        linked: true,
        pinned: false,
      },
    ],
  });
  const key = `person:${book.personId}`;
  const row = settlement.find((one) => one.key === key);
  if (!row) return null;
  // The same split the owner's card draws (see SettlementCard), so the two lists add up the same way.
  const receipts = paymentsSinceClosing(book.payments, book.settlements).get(key)?.counted ?? [];
  const { typed, discharges, discharged } = moneyRows(row, receipts);
  const bossName = new Map(bosses.map((b) => [b.bossKey, b.name]));
  const partyById = new Map(book.parties.map((p) => [p.id, p]));
  // The owner's card's own label for a drop's boss (SettlementCard's `behind`), mode included.
  const where = (line: WalletLine) => {
    const boss = line.bossKey ? bossName.get(line.bossKey) : undefined;
    if (!boss) return line.name;
    return `${line.name} \u00b7 ${bossLabel(boss, partyById.get(line.partyId)?.difficulty ?? null)}`;
  };
  // Your shares one drop at a time, where they add up to the figure exactly. Otherwise the figure
  // alone: a list that comes to a different total is two answers to one debt.
  const yourLines = row.lines.filter(
    (line) => line.direction === "owed" && line.currency === "MESO",
  );
  const itemised = yourLines.reduce((sum, line) => sum + line.pay, 0) === row.parts.shares;
  const shares: SharedPart[] = itemised
    ? yourLines.map((line) => ({
        key: `${line.lootId}:${line.theirsId}`,
        label: where(line),
        mesos: line.pay,
        // A share of a drop YOU sold is yours to send, which the payout route lets the seller mark.
        send: { partyId: line.partyId, lootId: line.lootId, payeeId: line.payeeId },
        iconUrl: line.iconUrl,
      }))
    : [{ key: "shares", label: "Your shares", mesos: row.parts.shares }];
  // Who wrote each typed row and each receipt, so the card can name the owner's and offer your own back.
  const debtsById = new Map(book.debts.map((d) => [d.id, d]));
  const paymentsById = new Map(book.payments.map((p) => [p.id, p]));
  // A typed debt, either way: in their book positive is you owing them, negative them owing you.
  const enteredPart = (entry: (typeof typed)[number]): SharedPart => ({
    key: entry.id,
    label: entry.note ?? "Entered",
    mesos: Math.abs(entry.amount),
    by: entry.recordedByYou === false ? (entry.recordedByName ?? book.ownerName) : null,
    remove: entry.recordedByYou === true ? { kind: "debts" as const, id: entry.id } : undefined,
  });
  const owe: SharedPart[] = [
    ...shares,
    { key: "sold", label: `Coupons of ${book.ownerName}'s you kept`, mesos: row.parts.soldOfYours },
    ...typed.filter((entry) => entry.amount > 0).map(enteredPart),
  ].filter((part) => part.mesos !== 0);
  const paidLabel = { PAYMENT: "You paid", DEBT: "Offset", PROCEEDS: "Coupon sale" } as const;
  const disposalsById = new Map(book.disposals.map((d) => [d.id, d]));
  const writtenBy = (id: string, source: string) =>
    source === "PAYMENT"
      ? paymentsById.get(id)
      : source === "DEBT"
        ? debtsById.get(id)
        : disposalsById.get(id);
  const removable = { PAYMENT: "payments", DEBT: "debts", PROCEEDS: "disposals" } as const;
  return {
    name: book.ownerName,
    image: book.ownerImage ?? null,
    personId: book.personId,
    owed: row.owedByYou + row.sharesYouOwe,
    owe: row.mesos,
    holding: row.holding,
    youHold: row.heldByThem,
    youHoldSales: undecidedSales({ sales: row.salesHeldByThem, holding: row.heldByThem }),
    holdingSales: undecidedSales(row),
    piecesOwed: row.piecesYouOwe,
    piecesOwe: row.pieces,
    usd: { owed: row.usd.owe, owe: row.usd.owed, net: -row.usd.net },
    detail: {
      owe,
      oweTotal: owe.reduce((sum, part) => sum + part.mesos, 0),
      paid: discharges.map((act) => {
        const row = writtenBy(act.id, act.source);
        return {
          key: act.id,
          label:
            act.label === "you paid"
              ? `${book.ownerName} paid you`
              : act.label === "paid" || act.label === "offset"
                ? paidLabel[act.source]
                : act.label,
          mesos: act.amount,
          by: row?.recordedByYou === false ? (row.recordedByName ?? book.ownerName) : null,
          // Only a typed credit, a receipt or a coupon-money decision: an offset of shares is the
          // owner's act on their own shares.
          remove:
            row?.recordedByYou === true && (act.source !== "DEBT" || act.payouts.length === 0)
              ? { kind: removable[act.source], id: act.id }
              : undefined,
        };
      }),
      paidTotal: discharged,
      // "owe" in their book is them owing you.
      theyOwe: row.lines
        .filter((line) => line.direction === "owe")
        .map((line) => ({ ...line, name: where(line) })),
      theyOweEntered: typed.filter((entry) => entry.amount < 0).map(enteredPart),
      holding: row.holding,
    },
  };
}

/** [totals] with every shared card added in, so the tiles cover each book you are owed or owe in. */
export function withSharedCards(totals: SettlementTotals, cards: SharedCard[]): SettlementTotals {
  const owed = totals.owed + cards.reduce((sum, card) => sum + card.owed, 0);
  const owe = totals.owe + cards.reduce((sum, card) => sum + card.owe, 0);
  const usdOwed = totals.usd.owed + cards.reduce((sum, card) => sum + card.usd.owed, 0);
  const usdOwe = totals.usd.owe + cards.reduce((sum, card) => sum + card.usd.owe, 0);
  return {
    owed,
    owe,
    net: owed - owe,
    people: totals.people + cards.length,
    usd: { owed: usdOwed, owe: usdOwe, net: usdOwed - usdOwe },
  };
}
