import { heldMesos, type Settlement } from "@/lib/settlement";
import type { SharedCard } from "@/lib/shared-book";
import type { Payer, SettlementListing } from "@/types/settlement-listing";

// Auction house listings on a Settlement card. A listing is good for the figure it was posted for
// and no other: the figures below are reported as the page draws, and the backend deletes a listing
// for any other amount. See backend SettlementListings.kt.

export const LISTINGS_KEY = "/api/settlement-listings";

/** What one screen says a card's payer holds, as POST /api/settlement-listings/figures takes it. */
export type ReportedFigure = { personId: string; payer: Payer; amount: number };

/**
 * The listing standing on this card for [payer], or null.
 *
 * Null as well when it was posted for another amount. The backend deletes that one once a figure is
 * reported, and until then it must not be drawn beside a button that pays a different figure.
 */
export function liveListing(
  listings: SettlementListing[],
  personId: string,
  payer: Payer,
  amount: number,
): SettlementListing | null {
  return (
    listings.find(
      (listing) =>
        listing.personId === personId && listing.payer === payer && listing.amount === amount,
    ) ?? null
  );
}

/**
 * Both directions of every card between two linked accounts on this page.
 *
 * A linked person with no row is reported at zero, which is what a settled card holds: the row goes
 * when nothing stands between you, and a listing for the amount that was there must go with it.
 */
export function figuresToReport(
  rows: Settlement[],
  linkedPeople: string[],
  cards: SharedCard[],
): ReportedFigure[] {
  const own = linkedPeople.flatMap((personId) => {
    const row = rows.find((one) => one.key === `person:${personId}`);
    const held = row ? heldMesos(row) : { byYou: 0, byThem: 0 };
    return [
      { personId, payer: "OWNER" as const, amount: held.byYou },
      { personId, payer: "MEMBER" as const, amount: held.byThem },
    ];
  });
  const shared = cards.flatMap((card) => [
    { personId: card.personId, payer: "OWNER" as const, amount: card.held.byOwner },
    { personId: card.personId, payer: "MEMBER" as const, amount: card.held.byYou },
  ]);
  return [...own, ...shared];
}
