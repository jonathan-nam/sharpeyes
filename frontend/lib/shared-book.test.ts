import { describe, expect, it } from "vitest";
import { sharedCard } from "@/lib/shared-book";
import { settlementView } from "@/lib/settlement-view";
import type { Holder } from "@/lib/vestige-ledger";
import type { SharedBook } from "@/types/page";

// Your card in somebody else's book has to state their figure from the other end, or the two
// pages give two answers to one debt.

const B = 1_000_000_000;
const YOU: Holder = { kind: "PERSON", personId: "p-you", characterName: null };

const book = (fields: Partial<SharedBook>): SharedBook => ({
  ownerName: "Jonathan",
  personId: "p-you",
  parties: [],
  pools: [],
  tranches: [],
  payments: [],
  settlements: [],
  debts: [],
  disposals: [],
  ...fields,
});

const debt = (amount: number) => ({
  id: `d-${amount}`,
  holder: YOU,
  amount,
  note: null,
  payouts: [],
  incurredAt: "2026-10-01T00:00:00Z",
});

const paid = (amount: number) => ({
  id: `p-${amount}`,
  holder: YOU,
  amount,
  note: null,
  receivedAt: "2026-10-02T00:00:00Z",
});

describe("sharedCard", () => {
  it("says what the owner owes you when you overpaid them", () => {
    // Bro's card on 2026-10-20: 187b paid against 139b, read from Bro's side.
    const card = sharedCard(book({ debts: [debt(139 * B)], payments: [paid(187 * B)] }), []);
    expect([card?.owed, card?.owe]).toEqual([48 * B, 0]);
  });

  it("says what you owe the owner", () => {
    const card = sharedCard(book({ debts: [debt(100 * B)] }), []);
    expect([card?.owed, card?.owe]).toEqual([0, 100 * B]);
  });

  it("is the owner's own row, swapped", () => {
    const shared = book({ debts: [debt(139 * B)], payments: [paid(187 * B)] });
    const theirs = settlementView({ ...shared, bosses: [], people: [] }).settlement.find(
      (row) => row.key === "person:p-you",
    )!;
    const yours = sharedCard(shared, [])!;
    expect([yours.owed, yours.owe]).toEqual([theirs.owedByYou + theirs.sharesYouOwe, theirs.mesos]);
  });

  it("is nothing when the book says nothing about you", () => {
    expect(sharedCard(book({}), [])).toBeNull();
  });
});
