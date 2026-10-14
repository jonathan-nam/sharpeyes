"use client";

import { useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import {
  type AmountBasis,
  explainSplit,
  FEE_STANDARD,
  formatMesos,
  parseMesos,
  type SplitInput,
  type SplitMethod,
  splitDrop,
} from "@/lib/drop-split";
import { queryParam, replaceQuery, useQueryString } from "@/lib/url-state";

const MAX_PARTY = 6;
const BASES: readonly AmountBasis[] = ["listed", "received"];
const METHODS: readonly SplitMethod[] = ["fair", "lazy"];

const percent = (fee: number) => `${(fee * 100).toFixed(0)}%`;

export default function DropSplitPage() {
  const [price, setPrice] = useState("");
  const [partySize, setPartySize] = useState(6);

  // The three toggles are kept in the URL, so a reload keeps them. See lib/url-state.ts.
  const search = useQueryString();
  const [chosenBasis, setChosenBasis] = useState<AmountBasis | null>(null);
  const [chosenMethod, setChosenMethod] = useState<SplitMethod | null>(null);
  const [chosenGrouped, setChosenGrouped] = useState<boolean | null>(null);
  const amountIs = chosenBasis ?? queryParam(search, "amount", BASES) ?? "listed";
  const method = chosenMethod ?? queryParam(search, "method", METHODS) ?? "fair";
  // Raw digits by default: these get pasted into the game's price box, which takes nothing else.
  const grouped = chosenGrouped ?? queryParam(search, "commas", ["on"]) === "on";

  function setAmountIs(next: AmountBasis) {
    setChosenBasis(next);
    replaceQuery({ amount: next === "listed" ? null : next });
  }
  function setMethod(next: SplitMethod) {
    setChosenMethod(next);
    replaceQuery({ method: next === "fair" ? null : next });
  }
  function setGrouped(next: boolean) {
    setChosenGrouped(next);
    replaceQuery({ commas: next ? "on" : null });
  }

  const mesos = (value: number) => formatMesos(value, grouped);

  const others = partySize - 1;

  // Everyone at the standard rate. splitDrop still takes a rate PER PERSON, because the payout
  // hop is charged to whoever receives it and MVP members are genuinely cheaper. Asking for that
  // per member was a form demanding what the person handing out loot rarely knows, so the caller
  // assumes the common case and the note below says so.
  const memberFees = Array.from({ length: others }, () => FEE_STANDARD);

  // Null while the price is empty or unreadable. Showing nothing beats showing a split derived
  // from half a typed number.
  const amount = parseMesos(price);
  const input: SplitInput | null =
    amount === null ? null : { amount, amountIs, sellerFee: FEE_STANDARD, memberFees, method };
  const split = input === null ? null : splitDrop(input);

  return (
    <main className="page">
      <h1 className="page-title">Split Utility</h1>

      <div className="split-form">
        <div className="split-field">
          <span className="basis-row">
            {(
              [
                ["listed", "Gross Sale Amount"],
                ["received", "Net Sale Amount"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={amountIs === value ? "basis-tab active" : "basis-tab"}>
                <input
                  type="radio"
                  name="basis"
                  checked={amountIs === value}
                  onChange={() => setAmountIs(value)}
                />
                {label}
              </label>
            ))}
          </span>
          <input
            className="split-input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 9.5b, 970m, 1,000,000,000"
            inputMode="text"
            aria-label={amountIs === "listed" ? "Gross Sale Amount" : "Net Sale Amount"}
            autoFocus
          />
        </div>

        <label className="split-field">
          <span>Party Size (Including You)</span>
          <input
            className="split-input"
            type="number"
            min={1}
            max={MAX_PARTY}
            value={partySize}
            onChange={(e) =>
              setPartySize(Math.min(MAX_PARTY, Math.max(1, Number(e.target.value) || 1)))
            }
          />
        </label>

        <fieldset className="split-field split-methods">
          <legend>Split</legend>
          {(
            [
              ["fair", "Fair"],
              ["lazy", "Lazy"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={method === value ? "split-method active" : "split-method"}
            >
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
              />
              <span className="split-method-label">{label}</span>
            </label>
          ))}
        </fieldset>
      </div>

      {price.trim() !== "" && amount === null && (
        <p className="split-error">Not an amount. Try 9.5b or 970m.</p>
      )}

      {split && input && (
        <div className="split-result">
          <p className="split-headline">
            {others === 0 ? (
              <>
                Nobody to pay. You keep <strong>{mesos(split.sellerKeeps)}</strong>.
              </>
            ) : (
              <>
                Send{" "}
                <CopyAmount
                  value={split.members[0]?.pay ?? 0}
                  display={mesos(split.members[0]?.pay ?? 0)}
                />{" "}
                to each of the other {others}
                {others === 1 ? " member" : " members"}.
              </>
            )}
          </p>

          <button
            type="button"
            className="group-toggle"
            onClick={() => setGrouped(!grouped)}
            aria-pressed={grouped}
          >
            {grouped ? "Show Raw Numbers" : "Show Comma Separators"}
          </button>

          <table className="split-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>You Send</th>
                <th>They End Up With</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>You</td>
                <td className="split-dash">&mdash;</td>
                <td>{mesos(split.sellerKeeps)}</td>
              </tr>
              {split.members.map((m, i) => (
                // Members are positions in a party, not entities: there is nothing else to key on.
                // A saved party's seats do have ids; this calculator has no party behind it.
                <tr key={i}>
                  <td>Member {i + 1}</td>
                  <td>
                    <CopyAmount value={m.pay} display={mesos(m.pay)} />
                  </td>
                  <td>{mesos(m.nets)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="split-lines">
            <div>
              <dt>You Received From the Sale</dt>
              <dd>{mesos(split.sellerReceives)}</dd>
            </div>
            <div className="split-fee">
              {/* Says which hops it covers: on a received figure the sale's fee is unknown. */}
              <dt>
                Lost to the Auction House{split.totalFeeCoversSale ? "" : " (on the payouts)"}
              </dt>
              <dd>{mesos(split.totalFee)}</dd>
            </div>
          </dl>

          <details className="split-math">
            <summary>Show the Math</summary>
            <ol className="math-steps">
              {explainSplit(input, split, { grouped }).map((step) => (
                <li key={step.label}>
                  <span className="math-label">{step.label}</span>
                  <span className="math-expression">{step.expression}</span>
                </li>
              ))}
            </ol>
            <p className="math-fee">Fee: {percent(FEE_STANDARD)}</p>
          </details>
        </div>
      )}
    </main>
  );
}
