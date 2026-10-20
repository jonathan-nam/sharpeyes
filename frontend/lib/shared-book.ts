import { settlementView } from "@/lib/settlement-view";
import type { Owings } from "@/lib/wallet";
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
  const row = settlement.find((one) => one.key === `person:${book.personId}`);
  if (!row) return null;
  return {
    name: book.ownerName,
    owed: row.owedByYou + row.sharesYouOwe,
    owe: row.mesos,
    holding: row.holding,
    piecesOwed: row.piecesYouOwe,
    piecesOwe: row.pieces,
    usd: { owed: row.usd.owe, owe: row.usd.owed, net: -row.usd.net },
  };
}
