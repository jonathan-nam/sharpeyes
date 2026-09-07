"use client";

import { useState } from "react";
import { Field } from "@/components/add-field";
import { formatMoney, parseAmount } from "@/lib/money";
import { divides } from "@/lib/loot";
import { parseShares, sharePercents } from "@/lib/shares";
import type { SellLootBody } from "@/types/loot";
import type { PartyMember } from "@/types/party";

// What one drop sold for: the price, what that price IS, how it divides, and who sold it.
//
// One form, two frames. It sits on the pool row on Party View and on the card that prices the same
// drop from the Drop Log's Sale Ledger, because a ring sold on one screen and a ring sold on the
// other are the same act. Two copies of these boxes would be two answers to the split the first
// time one of them changed.
//
// Nothing here divides anything. It hands `shares` to the sale route, and splitOf() reads what the
// server wrote.

export function LootSaleForm({
  ran,
  busy,
  onSell,
  onCancel,
  labelled,
}: {
  /**
   * Who could have sold this drop: the seats that ran the week it FELL in, not the party as it
   * stands now. Offering more than that would offer a seller the sell route refuses, and offering
   * the week's roster for a guest week is the only way to name the guest who actually sold it.
   */
  ran: PartyMember[];
  busy: boolean;
  onSell: (body: SellLootBody) => void;
  /** Absent where the form is the card rather than a mode of a row, which has nothing to go back to. */
  onCancel?: () => void;
  /**
   * Name every box and flatten the words out of the options, which is how the Sale Ledger draws it.
   *
   * Not on the pool row, which is where the other copy of this form lives. There the row reads as a
   * sentence ("9.5b, listed for, fair split, sold by Alice") and the option text IS the wording, so
   * labelling it would say each thing twice.
   */
  labelled?: boolean;
}) {
  const [price, setPrice] = useState("");
  const [amountBasis, setAmountBasis] = useState("LISTED");
  const [splitMethod, setSplitMethod] = useState("FAIR");
  const [sellerMemberId, setSellerMemberId] = useState(ran[0]?.id ?? "");
  // Every seat opens on one share, and an uneven split is typed here. It used to be seeded from
  // `party_member.shares`, which is the STACK entitlement the party config's boxes write: a duo
  // splitting three vestige stacks 1 and 2 had every ring and grindstone they ever sold open at
  // 1:2. That ratio divides the coupon pile and nothing else, which is ranSeats' job, not this one.
  const [shares, setShares] = useState<Record<string, string>>({});
  const shareOf = (memberId: string) => shares[memberId] ?? "1";
  const entered = ran.map((m) => parseShares(shareOf(m.id)));
  const sharesReadable = entered.every((count) => count !== null);
  // What each box works out to as a percentage of the pot, which is the thing a share count means
  // and the thing a deal is agreed in. Derived and never typed: an 80/20 deal reads 80 and 20, and
  // so does 4 and 1, so the box cannot be labelled a percentage without being wrong half the time.
  const percent = sharesReadable ? sharePercents(entered.map((count) => count ?? 0)) : null;
  // The price and the unit it was written in. A leading "$" is the whole switch: see parseAmount.
  const money = parseAmount(price);
  const inDollars = money?.currency === "USD";
  // Whether this drop divides at all, which is what every control below asks about.
  const shared = divides(ran);
  // Real money never crossed the Auction House, so there is no cut for a gross figure to be gross
  // OF and the server refuses that pairing. Coerced rather than merely hidden: a basis left in the
  // state after the box gained a "$" would be submitted and refused with the option off screen.
  const basis = inDollars && amountBasis === "LISTED" ? "RECEIVED" : amountBasis;
  // Fair and lazy are the same arithmetic at a rate of zero, so a dollar sale is not asked. Stored
  // as the plain division rather than as whichever the state happens to hold, so the row does not
  // claim a choice that changed nothing.
  const method = inDollars ? "LAZY" : splitMethod;

  return (
    <form
      className="loot-sale-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (money === null || !sellerMemberId || !sharesReadable) return;
        onSell({
          // One or the other. A dollar sale sends no meso figure at all, because there is no rate
          // to work one out at and a zero would be stored as a price if the server ever read it.
          amount: inDollars ? 0 : money.amount,
          usdCents: inDollars ? money.amount : undefined,
          amountBasis: basis,
          splitMethod: method,
          sellerMemberId,
          shares: Object.fromEntries(ran.map((m, i) => [m.id, entered[i] ?? 1])),
        });
      }}
    >
      <div className={labelled ? "add-fields" : "loot-sale-line"}>
        <Field on={Boolean(labelled)} label="Sale Amount" cls="is-price">
          <input
            className="split-input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            // Both notations, because neither is guessable and the "$" is the only thing that
            // says a sale can be in real money at all. Same argument as the b suffix carrying
            // this box before it: see the note on the entry card in add-settlement.tsx.
            placeholder="9.5b or $1000"
            aria-label={labelled ? undefined : "Sale amount"}
            inputMode="decimal"
          />
        </Field>
        <Field on={Boolean(labelled)} label="Sale Type" cls="is-pick">
          <select
            className="split-input"
            value={basis}
            onChange={(e) => setAmountBasis(e.target.value)}
            aria-label={labelled ? undefined : "What that amount is"}
          >
            {!inDollars && <option value="LISTED">{labelled ? "Gross" : "listed for"}</option>}
            <option value="RECEIVED">{labelled ? "Net" : "received"}</option>
            {/* No listing, so no Auction House cut off the top: the price is the whole pot.
                The payouts are still taxed, so the split is the same one. Not offered where one
                seat ran: there is nobody to have bought it off. */}
            {shared && (
              <option value="BOUGHT">{labelled ? "Member bought" : "member bought"}</option>
            )}
          </select>
        </Field>
        {/* Neither control is a question where one seat ran: nobody to divide with and nobody
            else it could have been sold by. The stored method is whichever the state holds,
            and with no members splitDrop's two branches are the same arithmetic (see the
            test).

            Nor is the split a question in dollars. What fair costs over lazy is one hop's Auction
            House fee, and real money pays none, so the two branches compute the same figures and
            a control offering them would be a choice that changes nothing. */}
        {shared && !inDollars && (
          <Field on={Boolean(labelled)} label="Split" cls="is-narrow">
            <select
              className="split-input"
              value={splitMethod}
              onChange={(e) => setSplitMethod(e.target.value)}
              aria-label={labelled ? undefined : "Split method"}
            >
              {/* Both are offered for the reason lib/drop-split.ts gives: "lazy" is what most
                  parties do, and only showing "fair" would hide what it costs. */}
              <option value="FAIR">{labelled ? "Fair" : "fair split"}</option>
              <option value="LAZY">{labelled ? "Lazy" : "lazy split"}</option>
            </select>
          </Field>
        )}
        {shared && (
          <Field on={Boolean(labelled)} label={basis === "BOUGHT" ? "Bought by" : "Sold by"}>
            <select
              className="split-input"
              value={sellerMemberId}
              onChange={(e) => setSellerMemberId(e.target.value)}
              aria-label={
                labelled ? undefined : basis === "BOUGHT" ? "Who bought it" : "Who sold it"
              }
            >
              {ran.map((m) => (
                <option key={m.id} value={m.id}>
                  {labelled ? m.name : `${basis === "BOUGHT" ? "bought by" : "sold by"} ${m.name}`}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {/* One box per seat that ran, so an uneven split is typed where the sale is. Not where
          one seat ran, which has nobody to divide with. */}
      {shared && <h4 className="loot-group-title is-config">Splits</h4>}
      {shared && (
        <div className="loot-share-inputs">
          {ran.map((m, i) => (
            <span key={m.id} className="loot-share-input">
              <span className="loot-share-name">{m.name}</span>
              <input
                className="split-input loot-count-input"
                value={shareOf(m.id)}
                onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })}
                aria-label={`Shares for ${m.name}`}
                inputMode="numeric"
                maxLength={2}
                // Blank is ONE, not nothing, so this is what the box already means rather than a
                // suggestion. An example ratio here would state a split nobody typed. See V44.
                placeholder="1"
              />
              {/* The share as a percentage, which is what says these boxes are a ratio at all. Two
                  names with a 1 in each said nothing about being relative to one another. */}
              {percent && <span className="loot-share-pct">{percent[i]}%</span>}
            </span>
          ))}
        </div>
      )}

      <div className="loot-actions">
        {/* Without a seller there is nobody to measure the shares against, and the submit
            would return without saying so. */}
        <button
          type="submit"
          className="party-save"
          disabled={busy || money === null || !sellerMemberId || !sharesReadable}
        >
          Save sale
        </button>
        {onCancel && (
          <button type="button" className="party-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        {/* Shown before saving, so a typed "9.5b" is confirmed as 9,500,000,000 rather than
            discovered afterwards. It is also what makes the unit visible: "$1000" echoes back as
            $1,000.00, which is the only thing on screen saying the "$" was read as one. */}
        {price !== "" && (
          <span className="loot-parsed">
            {money === null ? "not a price" : formatMoney(money.amount, money.currency, true)}
          </span>
        )}
      </div>
    </form>
  );
}
