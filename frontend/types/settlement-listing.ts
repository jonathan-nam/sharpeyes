// GET /api/settlement-listings. See backend SettlementListings.kt.

/** The side of a card holding the money: the book's owner, or the linked member. */
export type Payer = "OWNER" | "MEMBER";

/** An auction house listing the payee posted, for the payer to pay into. */
export type SettlementListing = {
  id: string;
  /** The card: the member's person row on the owner's account. */
  personId: string;
  payer: Payer;
  /** The Held By figure it was posted for. Good for exactly this amount and no other. */
  amount: number;
  postedByYou: boolean;
  createdAt: string;
};
