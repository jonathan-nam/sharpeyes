"use client";

import { useState } from "react";
import { parseMesos } from "@/lib/drop-split";
import type { Holder } from "@/lib/vestige-ledger";
import type { Person } from "@/types/party";

// The two boxes nothing else on any screen records: a debt somebody owes you that no drop accounts
// for, and mesos arriving against everything at once.
//
// A CARD OF ITS OWN, the way the Drop Log's and the Sale Ledger's entry cards are, above the
// settlement cards it writes to. Both boxes used to sit inside each card, which put a form between
// every card's arithmetic and the next card's, and the debt half could not open the FIRST debt of a
// relationship at all: a card is drawn for somebody who already owes you something, so a loan to
// somebody you have never split a drop with had nowhere to go.
//
// A card names its person, so the boxes inside one did not have to. Out here they do, which is the
// picker.

/** Somebody a payment can arrive from, or a debt be entered against. */
type Payer = { key: string; name: string; holder: Holder };

export function AddSettlement({
  people,
  holders,
  busy,
  onAddDebt,
  onAddPayment,
}: {
  /** The account's people list, in its own order. A debt is entered against one of these. */
  people: Person[];
  /**
   * Everybody who already has a settlement card, so a payment from one can be recorded.
   *
   * PEOPLE are not enough here. A card can be keyed by a character nobody has claimed yet, and the
   * box inside that card was the only place a payment from them could be entered. See holderFromKey.
   */
  holders: Payer[];
  busy: boolean;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onAddPayment: (holder: Holder, amount: number, note: string) => Promise<void>;
}) {
  const [owedTo, setOwedTo] = useState("");
  const [owed, setOwed] = useState("");
  const [note, setNote] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [got, setGot] = useState("");
  // Its own, not the debt form's: two forms sharing one box would clear a half-typed note in the
  // other the moment either saved.
  const [gotNote, setGotNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  // Who a debt can be entered against: a PERSON, because a debt is between two humans, which is
  // what the holder fold has meant everywhere since V39. The picker is the people list so a name
  // cannot arrive misspelled.
  const debtors: Payer[] = people.map((person) => ({
    key: `person:${person.id}`,
    name: person.name,
    holder: { kind: "PERSON", personId: person.id, characterName: null },
  }));
  // And who a payment can come from: those, plus the unclaimed characters with a card of their own.
  const payers: Payer[] = [
    ...debtors,
    ...holders.filter(
      (one) => one.holder.kind !== "PERSON" && !debtors.some((debtor) => debtor.key === one.key),
    ),
  ];

  const entered = parseMesos(owed);
  const amount = entered !== null && entered >= 1 ? entered : null;
  const payment = parseMesos(got);
  const paid = payment !== null && payment >= 1 ? payment : null;
  const debtor = debtors.find((one) => one.key === owedTo) ?? debtors[0];
  const payer = payers.find((one) => one.key === paidBy) ?? payers[0];

  // A picker of nobody is a control that cannot be completed, which is worse than no control.
  if (payers.length === 0) return null;

  async function write(action: Promise<void>, clear: () => void) {
    setRefusal(null);
    try {
      await action;
      clear();
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      {debtor && (
        <div className="ledger-entry">
          {/* The one figure on this page nothing else could have known. See V56.

              "Bro owes me ___ for ___" was a sentence spread over two boxes, with no unit on either
              and nothing saying what "for" wanted. The step names the act, the labels name the
              fields, and the b/m suffix is the one thing about parseMesos nobody can guess, so it
              stays a placeholder on the amount. */}
          <span className="ledger-heading">Add Debt</span>
          <form
            className="ledger-sale"
            onSubmit={(e) => {
              e.preventDefault();
              if (!amount) return;
              void write(onAddDebt(debtor.holder, amount, note.trim()), () => {
                setOwed("");
                setNote("");
              });
            }}
          >
            <label className="loot-share-input is-stacked">
              Who
              <select
                className="split-input"
                value={debtor.key}
                onChange={(e) => setOwedTo(e.target.value)}
                aria-label="Who owes you"
                disabled={busy}
              >
                {debtors.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="loot-share-input is-stacked">
              Amount
              <input
                className="split-input"
                value={owed}
                onChange={(e) => setOwed(e.target.value)}
                placeholder="1.5b"
                inputMode="decimal"
                aria-label={`Amount ${debtor.name} owes you`}
              />
            </label>
            <label className="loot-share-input is-grow is-stacked">
              Description
              <input
                className="split-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={120}
                aria-label="Description, optional"
              />
            </label>
            {/* A + rather than the word: two forms in one card would both read "Add", and what each
                one adds is what its step says. The label is the act, the mark not being text. */}
            <button
              type="submit"
              className="party-save ledger-add"
              disabled={busy || amount === null}
              aria-label={`Add what ${debtor.name} owes you`}
            >
              +
            </button>
          </form>
        </div>
      )}

      {payer && (
        <div className="ledger-entry">
          {/* Mesos arriving, against everything on their card at once. A payment is against the
              person, not against a particular boss or a particular coupon. See V51. */}
          <span className="ledger-heading">Add Payment</span>
          <form
            className="ledger-sale"
            onSubmit={(e) => {
              e.preventDefault();
              if (!paid) return;
              void write(onAddPayment(payer.holder, paid, gotNote.trim()), () => {
                setGot("");
                setGotNote("");
              });
            }}
          >
            <label className="loot-share-input is-stacked">
              Who
              <select
                className="split-input"
                value={payer.key}
                onChange={(e) => setPaidBy(e.target.value)}
                aria-label="Who paid you"
                disabled={busy}
              >
                {payers.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="loot-share-input is-stacked">
              Amount
              <input
                className="split-input"
                value={got}
                onChange={(e) => setGot(e.target.value)}
                placeholder="1.5b"
                inputMode="decimal"
                aria-label={`Amount ${payer.name} has paid you`}
              />
            </label>
            {/* The same box the entry above it carries, in the same words. A receipt that cannot say
                what it answered is one nobody can check a month later. */}
            <label className="loot-share-input is-grow is-stacked">
              Description
              <input
                className="split-input"
                value={gotNote}
                onChange={(e) => setGotNote(e.target.value)}
                maxLength={120}
                aria-label="Description, optional"
              />
            </label>
            <button
              type="submit"
              className="party-save ledger-add"
              disabled={busy || paid === null}
              aria-label={`Add a payment from ${payer.name}`}
            >
              +
            </button>
          </form>
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}
