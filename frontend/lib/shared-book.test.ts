import { describe, expect, it } from "vitest";
import { sharedCard, withSharedCards } from "@/lib/shared-book";
import { settlementView } from "@/lib/settlement-view";
import type { Holder } from "@/lib/vestige-ledger";
import type { SharedBook } from "@/types/page";

// Your card in somebody else's book has to state their figure from the other end, or the two
// pages give two answers to one debt.

const B = 1_000_000_000;
const YOU: Holder = { kind: "PERSON", personId: "p-you", characterName: null };

const book = (fields: Partial<SharedBook>): SharedBook => ({
  ownerName: "Jonas",
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

describe("a debt entered each way", () => {
  it("lists what they owe you under them, and what you owe under you, never under paid", () => {
    // Their book: you owe them 10b, and you said they owe you 8b (negative there).
    const card = sharedCard(
      book({ debts: [debt(10 * B), { ...debt(-8 * B), note: "dinner" }] }),
      [],
    )!;
    expect(card.detail.owe.map((p) => p.mesos)).toEqual([10 * B]);
    expect(card.detail.theyOweEntered.map((p) => [p.label, p.mesos])).toEqual([["dinner", 8 * B]]);
    expect(card.detail.paid).toEqual([]);
    expect(card.owe).toBe(2 * B);
  });
});

describe("a payment the owner sends back (V89)", () => {
  it("comes off what the owner owes you, and says who paid whom", () => {
    // You entered 8b they owe you; they paid 3b of it back, a negative row in their book.
    const card = sharedCard(book({ debts: [debt(-8 * B)], payments: [paid(-3 * B)] }), [])!;
    expect(card.owed).toBe(5 * B);
    expect(card.owe).toBe(0);
    expect(card.detail.paid.find((p) => p.key === `p-${-3 * B}`)?.label).toBe("Jonathan paid you");
  });
});

describe("sharedCard", () => {
  it("says what the owner owes you when you overpaid them", () => {
    // Brock's card on 2026-10-20: 187b paid against 139b, read from Brock's side.
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

  it("itemises the figure: what you owe, less what came off, is the net either way", () => {
    // The same arithmetic SettlementCard's Owed and Drops lists come to. See settlement.test.ts.
    const card = sharedCard(book({ debts: [debt(139 * B)], payments: [paid(187 * B)] }), [])!;
    expect(card.detail.owe).toMatchObject([
      { key: "d-139000000000", label: "Entered", mesos: 139 * B },
    ]);
    expect(card.detail.paid).toMatchObject([
      { key: "p-187000000000", label: "You paid", mesos: 187 * B },
    ]);
    expect(card.detail.oweTotal - card.detail.paidTotal).toBe(card.owe - card.owed);
  });

  it("names the owner's rows and offers yours back", () => {
    // One book, two writers (V88): the owner's entry says it is theirs, yours can be taken back.
    const theirs = { ...debt(139 * B), recordedByYou: false, recordedByName: "Mech" };
    const yours = { ...paid(187 * B), recordedByYou: true };
    const card = sharedCard(book({ debts: [theirs], payments: [yours] }), [])!;
    expect(card.detail.owe[0]).toMatchObject({ by: "Mech", remove: undefined });
    expect(card.detail.paid[0]).toMatchObject({
      by: null,
      remove: { kind: "payments", id: "p-187000000000" },
    });
  });

  it("is nothing when the book says nothing about you", () => {
    expect(sharedCard(book({}), [])).toBeNull();
  });
});

describe("the summary tiles with a shared book in them", () => {
  it("adds each card to your own book's totals", () => {
    // You owe 139b on their card and they hold a 187b payment of yours: 48b their way.
    const card = sharedCard(book({ debts: [debt(139 * B)], payments: [paid(187 * B)] }), [])!;
    const none = { owed: 0, owe: 0, net: 0, people: 0, usd: { owed: 0, owe: 0, net: 0 } };
    const totals = withSharedCards(none, [card]);
    expect(totals).toMatchObject({ owed: card.owed, owe: card.owe, people: 1 });
    expect(totals.net).toBe(card.owed - card.owe);
    const own = {
      owed: 10 * B,
      owe: 4 * B,
      net: 6 * B,
      people: 2,
      usd: { owed: 0, owe: 0, net: 0 },
    };
    expect(withSharedCards(own, [card]).net).toBe(6 * B + card.owed - card.owe);
  });
});
