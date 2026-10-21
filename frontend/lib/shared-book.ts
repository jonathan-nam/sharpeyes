import { bossLabel } from "@/lib/boss-difficulty";
import { moneyRows } from "@/lib/settlement";
import { settlementView } from "@/lib/settlement-view";
import { paymentsSinceClosing } from "@/lib/vestige-ledger";
import type { Owings, WalletLine } from "@/lib/wallet";
import type { Boss } from "@/types/boss";
import type { SharedBook } from "@/types/page";

/** Your card in somebody else's book, from your side. Every figure is theirs, swapped. */
export type SharedCard = {
  name: string;
  /** Mesos they owe you: what their card says they owe you, netted or as unpaid shares. */
  owed: number;
  /** Mesos you owe them. */
  owe: number;
  /** Money of yours they are holding from a sale of your coupons, with nothing decided yet. */
  holding: number;
  /** Your coupons in their inventory, and theirs in yours, after the counts wash. */
  piecesOwed: number;
  piecesOwe: number;
  usd: Owings;
  detail: SharedDetail;
};

/** One row of a detail list: what it was, and its mesos. */
export type SharedPart = { key: string; label: string; mesos: number };

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
  const shares = itemised
    ? yourLines.map((line) => ({
        key: `${line.lootId}:${line.theirsId}`,
        label: where(line),
        mesos: line.pay,
      }))
    : [{ key: "shares", label: "Your shares", mesos: row.parts.shares }];
  const owe = [
    ...shares,
    { key: "sold", label: `Coupons of ${book.ownerName}'s you sold`, mesos: row.parts.soldOfYours },
    ...typed.map((entry) => ({
      key: entry.id,
      label: entry.note ?? "Entered",
      mesos: entry.amount,
    })),
  ].filter((part) => part.mesos !== 0);
  const paidLabel = { PAYMENT: "You paid", DEBT: "Offset", PROCEEDS: "Coupon sale" } as const;
  return {
    name: book.ownerName,
    owed: row.owedByYou + row.sharesYouOwe,
    owe: row.mesos,
    holding: row.holding,
    piecesOwed: row.piecesYouOwe,
    piecesOwe: row.pieces,
    usd: { owed: row.usd.owe, owe: row.usd.owed, net: -row.usd.net },
    detail: {
      owe,
      oweTotal: owe.reduce((sum, part) => sum + part.mesos, 0),
      paid: discharges.map((act) => ({
        key: act.id,
        label: act.label === "paid" || act.label === "offset" ? paidLabel[act.source] : act.label,
        mesos: act.amount,
      })),
      paidTotal: discharged,
      // "owe" in their book is them owing you.
      theyOwe: row.lines
        .filter((line) => line.direction === "owe")
        .map((line) => ({ ...line, name: where(line) })),
      holding: row.holding,
    },
  };
}
