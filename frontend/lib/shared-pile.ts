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
 * Nothing is flipped: a sale typed into it writes exactly the row their book needs (holder: you;
 * shares: theirs as SELF). Only the names change. Draw it with PieceLedger's `yours`.
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
  // Their book calls them "you". Keyed the same, so only the name changes.
  const drops = ledger.drops.map((drop) => ({
    ...drop,
    transfers: drop.transfers.map((t) => (t.toId === SELF_KEY ? { ...t, to: book.ownerName } : t)),
  }));
  return {
    personId: book.personId,
    ownerName: book.ownerName,
    // Not plain "You": your own pile's card already says that, and this is a second pile.
    ledger: { ...ledger, drops, holderName: `You · ${book.ownerName}'s parties` },
    heldOfYours: new Map(held > 0 ? [[SELF_KEY, held]] : []),
    tranches,
    decided: decidedSales(view.credits, book.disposals),
  };
}
