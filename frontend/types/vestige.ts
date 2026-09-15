// Mirrors backend's parties/VestigeRoutes.kt field-for-field.

import type { Holder } from "@/lib/vestige-ledger";
import type { PartyLootPool } from "@/types/loot";

// One tranche: "sold 50 pieces for 1.2b". It names no boss, because which boss its pieces paid for
// is worked out by lib/piece-ledger.ts rather than typed. See VestigeRoutes.kt.
export type VestigeTranche = {
  id: string;
  // Whose pile it is: a person, you, or a character nobody has claimed yet. Never a character of
  // somebody you have named, since one human's inventories are one pile. See V39.
  holder: Holder;
  pieces: number;
  // Mesos for the whole tranche. The per-piece figure is derived on every read, never stored. Null
  // on a KEPT row alone, which realized nothing. See V50.
  amount: number | null;
  // Read rather than inferred, the same way holder.kind is: with three kinds and two of them
  // carrying money, the amount can no longer say which this is.
  disposition: VestigeDisposition;
  // Whose pieces this sale was, where any of them were not the seller's. Empty is all their own,
  // which is every tranche entered before V56.
  shares: VestigeTrancheShare[];
  soldAt: string;
};

/**
 * How many pieces of one sale were somebody else's. See V56.
 *
 * A COUNT. Their share of the money is `pieces * amount / tranche pieces`, derived on read, so
 * correcting a mistyped amount moves it. The meso figure is never stored: see V40.
 */
export type VestigeTrancheShare = {
  // The CREDITOR, not the pile the sale came out of.
  holder: Holder;
  pieces: number;
};

/**
 * What happened to the pieces. All three take them out of the sellable pile.
 *
 * KEPT is redeemed rather than sold, and never more than the holder's own share. Not the same as a
 * sale for nothing: that prices the pieces at zero and makes the creditor absorb half of it, which
 * is what #281 was.
 *
 * BOUGHT is the creditor's pieces taken by the holder at an agreed price, paid to that creditor in
 * full rather than divided pro rata: these never went to market, so there is no pile to divide. It
 * is what lets KEPT be bounded at all. See V50.
 */
export type VestigeDisposition = "SOLD" | "KEPT" | "BOUGHT";

// POST /api/vestige-tranches. Answers with the whole tally, not the row added.
export type AddVestigeTrancheBody = {
  holder: Holder;
  pieces: number;
  // Absent on a KEPT row and required on the other two. The server refuses the two disagreeing,
  // matching the check in V50.
  amount?: number;
  disposition: VestigeDisposition;
  // Only on a SOLD row, and never more pieces than the sale held. The server refuses both.
  shares?: VestigeTrancheShare[];
};

// One payment: mesos that actually arrived from a holder, against what their whole pile owes. No
// pieces and no boss, because a payment is against the debt rather than against particular coupons.
// See V51.
export type VestigePayment = {
  id: string;
  holder: Holder;
  amount: number;
  // What it was for. Optional, and never read by the netting: a payment is against the whole debt,
  // so this labels the receipt rather than saying which piece of it went. See V64.
  note: string | null;
  receivedAt: string;
};

// POST /api/vestige-payments. Answers with the whole tally, not the row added.
export type AddVestigePaymentBody = {
  holder: Holder;
  amount: number;
  note?: string;
};

// One act of closing a holder's books: which drops it covered, and what was left unpaid. The drops
// rather than a date, so a drop backfilled from an earlier week later is not silently retired. See V52.
export type VestigeSettlement = {
  id: string;
  holder: Holder;
  lootIds: string[];
  // Mesos still owed when the books closed. Zero is a pile that balanced.
  unpaid: number;
  settledAt: string;
};

// POST /api/vestige-settlements. Answers with every settlement, not the one added.
export type AddVestigeSettlementBody = {
  holder: Holder;
  lootIds: string[];
  unpaid: number;
};

// One debt somebody owes you that no drop accounts for: a loan, a deal made in game, a split settled
// off the books. Positive is always what THEY owe YOU. See V56.
export type SettlementDebt = {
  id: string;
  holder: Holder;
  // Signed since V57. Positive is theirs to pay, negative is a debt of yours discharged against it.
  amount: number;
  // What it was for. Optional, and the only free text on the Settlement Ledger.
  note: string | null;
  // The shares an OFFSET discharged. Empty on a hand-entered debt, which is most of them. See V58.
  payouts: SettlementDebtPayout[];
  incurredAt: string;
};

// What a closing act moved: the shares it marked paid, the entries it was recorded as, and what it
// decided about their coupon money. See V57 and V61.
//
// All of it, because it wrote all of it, in one transaction. Two answers would be two repaints, and
// the halves of an offset cancel in the net, so the card drew the debt un-offset in between and
// finished on the figure it started on. The third list is the same failure one step out: a press
// covering the shares and the money walked what they owe you down in two visible steps.
export type OffsetShares = {
  pools: PartyLootPool[];
  debts: SettlementDebt[];
  disposals: ProceedsDisposal[];
};

// POST /api/settlement-debts/offset, and /sent for the same act pointed the other way.
//
// `holding` is their own money a sale of their coupons left in your hands, which one press decides
// about alongside the shares. Absent where there is none.
export type CloseSettlementBody = {
  holder: Holder;
  note?: string;
  // `amount` only where the act prices something, which is an offset: it is the figure the entry
  // carries. Sending prices nothing, and a share of a DOLLAR sale is settled by it, so there is no
  // meso figure to put on one. The server refuses an offset whose share names none.
  parts: { lootId: string; memberId: string; amount?: number }[];
  holding?: number;
};

// What became of the money a sale of somebody else's coupons left in your hands. See V61.
//
// Two things can happen to it and they end in different places, so which one it was is stored rather
// than read off a sign: OFFSET comes off what they owe you, PAID means you sent it and their debt did
// not move. Until one of these lands, the money is undecided and belongs in neither.
export type ProceedsDisposal = {
  id: string;
  holder: Holder;
  // Positive always. The direction is `kind`.
  amount: number;
  kind: "OFFSET" | "PAID";
  decidedAt: string;
};

// POST /api/proceeds-disposals. Answers with every row, not the one added.
export type AddProceedsDisposalBody = {
  holder: Holder;
  amount: number;
  kind: "OFFSET" | "PAID";
};

// One share an offset discharged. The PAYOUT, since one drop owes several people and only one of
// those shares is the one covered.
export type SettlementDebtPayout = {
  lootId: string;
  memberId: string;
};

// POST /api/settlement-debts. Answers with every entry, not the one added.
export type AddSettlementDebtBody = {
  holder: Holder;
  amount: number;
  note?: string;
  // Only an offset names any. Absent is a debt somebody typed, which discharges no share.
  payouts?: SettlementDebtPayout[];
};
