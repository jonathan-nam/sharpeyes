import { type ClosingNet, closingNet, type Settlement } from "@/lib/settlement";
import type { SharedCard } from "@/lib/shared-book";
import type { Payer, SettlementListing } from "@/types/settlement-listing";

// Auction house listings on a Settlement card. A listing is good for the figure it was posted for
// and no other: the figures below are reported as the page draws, and the backend deletes a listing
// for any other amount. The figure is what the payer sends after netting (closingNet), so the
// payee's listing and the payer's Mark Sent name one amount. See backend SettlementListings.kt.

/**
 * What [payer] sends on a card, given its net read from [reader]'s side: the net where they are
 * the one paying, nothing where they are not.
 */
export function paysOn(net: ClosingNet, reader: Payer, payer: Payer): number {
  const theyPay = reader === payer ? net.payer === "YOU" : net.payer === "THEM";
  return theyPay ? net.mesos : 0;
}

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
    const net = row ? closingNet(row) : null;
    return (["OWNER", "MEMBER"] as const).map((payer) => ({
      personId,
      payer,
      amount: net ? paysOn(net, "OWNER", payer) : 0,
    }));
  });
  const shared = cards.flatMap((card) =>
    (["OWNER", "MEMBER"] as const).map((payer) => ({
      personId: card.personId,
      payer,
      amount: paysOn(card.net, "MEMBER", payer),
    })),
  );
  return [...own, ...shared];
}
