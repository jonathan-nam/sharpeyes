import { type HeldOfYours, owedByCreditor } from "@/lib/ledger-fates";
import { decidedSales } from "@/lib/settlement";
import { settlementView } from "@/lib/settlement-view";
import { type HolderLedger, holderKey, SELF_KEY } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { SharedBook } from "@/types/page";
import type { VestigeTranche } from "@/types/vestige";

/** Your coupon pile in somebody else's book, ready for the same card your own pile is drawn with. */
export type SharedPile = {
  personId: string;
  ownerName: string;
  ledger: HolderLedger;
  heldOfYours: HeldOfYours;
  tranches: Map<string, VestigeTranche[]>;
  decided: Map<string, Set<string>>;
};

/**
 * Your pile as the owner's book keeps it: their ledger for your person row, unchanged.
 *
 * Nothing is flipped. That ledger is already the pile your coupons are in, and a sale typed into it
 * writes exactly the row their book needs (holder: you; shares: theirs as SELF). Only its title is
 * yours, in place of the name they call you by.
 *
 * Null when the book holds no pile of yours.
 */
export function sharedPile(book: SharedBook, bosses: Boss[]): SharedPile | null {
  const view = settlementView({
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
  const ledger = view.ledgers.find((one) => holderKey(one.holder) === key);
  if (!ledger) return null;

  // Coupons of yours THEIR pile holds, netted against what yours owes them: heldOfYoursBy's
  // subtraction, read from the other end. Their pile is SELF in their own book.
  const theirs = view.ledgers.find((one) => one.holder.kind === "SELF");
  const held = theirs ? (owedByCreditor(theirs).find((c) => c.key === key)?.pieces ?? 0) : 0;

  const tranches = new Map<string, VestigeTranche[]>();
  for (const tranche of book.tranches) {
    const k = holderKey(tranche.holder);
    tranches.set(k, [...(tranches.get(k) ?? []), tranche]);
  }
  return {
    personId: book.personId,
    ownerName: book.ownerName,
    // Not plain "You": your own pile's card already says that, and this is a second pile.
    ledger: { ...ledger, holderName: `You · ${book.ownerName}'s parties` },
    heldOfYours: new Map(held > 0 ? [[SELF_KEY, held]] : []),
    tranches,
    decided: decidedSales(view.credits, book.disposals),
  };
}
