"use client";

import { useState } from "react";
import { Field } from "@/components/add-field";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import {
  type LotDrop,
  type LotSaleBody,
  type LotShares,
  lotRosters,
  lotSaleBody,
  nearestCounts,
  priceLot,
  proposeLot,
} from "@/lib/lot-sale";
import { formatDropped } from "@/lib/loot";
import { parseShares, sharePercents } from "@/lib/shares";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

// One card per interchangeable drop you are holding unsold: the box that prices a pile of them, and
// the rows that pile would be filed against.
//
// The rows are shown before anything is written, and that is the point of the card. A queue can say
// which rows are OLDEST but not which of several identical drops actually left the inventory, so it
// proposes and you confirm. What it must never do is pick quietly.
//
// Nothing here divides anything. The per-row amounts are priceLot()'s, which is piece-ledger's
// largestRemainder, and each row's split stays splitDrop()'s once it is sold.

export function LotSale({
  drops,
  bossByKey,
  partyById,
  busy,
  onSell,
}: {
  drops: LotDrop[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onSell: (body: LotSaleBody) => Promise<void>;
}) {
  // Cards only. The "Outstanding Sales" heading covers these AND the coupon piles, so it belongs to
  // whatever draws both, not to one of them.
  if (drops.length === 0) return null;
  return (
    <>
      {drops.map((drop) => (
        <LotCard
          key={drop.dropKey}
          drop={drop}
          bossByKey={bossByKey}
          partyById={partyById}
          busy={busy}
          onSell={onSell}
        />
      ))}
    </>
  );
}

function LotCard({
  drop,
  bossByKey,
  partyById,
  busy,
  onSell,
}: {
  drop: LotDrop;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onSell: (body: LotSaleBody) => Promise<void>;
}) {
  const [count, setCount] = useState("");
  const [amount, setAmount] = useState("");
  const [amountBasis, setAmountBasis] = useState("LISTED");
  const [splitMethod, setSplitMethod] = useState("FAIR");
  // What each name takes, per roster, as typed. Every box opens on one share: see evenShares().
  const [shares, setShares] = useState<Record<string, Record<string, string>>>({});
  const [refusal, setRefusal] = useState<string | null>(null);

  const asked = Number(count.trim());
  const wanted = Number.isInteger(asked) && asked >= 1 ? asked : null;
  const total = parseMesos(amount);
  const proposal = wanted === null ? null : proposeLot(drop.queue, wanted);
  // Only ever over the rows the proposal actually covers, so a figure on screen is a figure that
  // would be filed. The queue's other rows are not part of this sale.
  const amounts = proposal && total !== null ? priceLot(total, proposal.rows) : null;

  // A count that does not land on a whole row. The rows either side are the choice, and saying
  // nothing here would leave a disabled button with no reason.
  const instead =
    proposal && proposal.rows.length === 0 ? nearestCounts(proposal.reachable, asked) : [];

  // The method only matters where there is somebody to divide with. Every row solo means one seat,
  // and the two methods are the same arithmetic on it: see the note in components/loot-row.tsx.
  const splits = drop.queue.some((row) => row.ran.length > 1);

  // One set of boxes per roster among the rows this sale would cover, so the ratio is typed once
  // for a pile the same people ran. Off the proposal rather than the queue: the boxes say what
  // would be written, and the queue's other rows are not part of this sale.
  const rosters = proposal ? lotRosters(proposal.rows) : [];
  const shareOf = (key: string, name: string) => shares[key]?.[name] ?? "1";
  const entered = rosters.map((r) => r.names.map((name) => parseShares(shareOf(r.key, name))));
  const sharesReadable = entered.every((counts) => counts.every((count) => count !== null));
  const typed: LotShares = Object.fromEntries(
    rosters.map((r, i) => [
      r.key,
      Object.fromEntries(r.names.map((name, j) => [name, entered[i]?.[j] ?? 1])),
    ]),
  );

  const ready = proposal !== null && proposal.rows.length > 0 && total !== null && sharesReadable;

  async function sell() {
    if (!ready) return;
    setRefusal(null);
    try {
      await onSell(
        lotSaleBody(drop.dropKey, total!, amountBasis, splitMethod, proposal!.rows, typed),
      );
      setCount("");
      setAmount("");
      setShares({});
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {drop.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(drop.iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">{drop.name}</span>
        </span>
        <span className="ledger-tally">
          {drop.units} unsold in {drop.queue.length} {drop.queue.length === 1 ? "drop" : "drops"}
        </span>
      </header>

      <form
        className="ledger-form"
        onSubmit={(e) => {
          e.preventDefault();
          void sell();
        }}
      >
        <div className="add-fields">
          <Field on label="Quantity" cls="is-narrow">
            <input
              className="split-input loot-count-input"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field on label="Sale Amount" cls="is-price">
            <input
              className="split-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="total"
              inputMode="decimal"
            />
          </Field>
          {/* No "member bought": a lot spans pools, and one member cannot have bought a pile out of
              parties they were not in. That case stays on the row, where it names its own buyer. */}
          <Field on label="Sale Type" cls="is-pick">
            <select
              className="split-input"
              value={amountBasis}
              onChange={(e) => setAmountBasis(e.target.value)}
            >
              <option value="LISTED">Gross</option>
              <option value="RECEIVED">Net</option>
            </select>
          </Field>
          {splits && (
            <Field on label="Split" cls="is-narrow">
              <select
                className="split-input"
                value={splitMethod}
                onChange={(e) => setSplitMethod(e.target.value)}
              >
                <option value="FAIR">Fair</option>
                <option value="LAZY">Lazy</option>
              </select>
            </Field>
          )}
        </div>
        {rosters.length > 0 && (
          <div className="ledger-splits">
            <h4 className="loot-group-title is-config">Splits</h4>
            {rosters.map((roster, i) => {
              const percent = entered[i]?.every((count) => count !== null)
                ? sharePercents(entered[i]?.map((count) => count ?? 0) ?? [])
                : null;
              return (
                <div key={roster.key} className="loot-share-inputs">
                  {roster.names.map((name, j) => (
                    <span key={name} className="loot-share-input">
                      <span className="loot-share-name">{name}</span>
                      <input
                        className="split-input loot-count-input"
                        value={shareOf(roster.key, name)}
                        onChange={(e) =>
                          setShares({
                            ...shares,
                            [roster.key]: { ...shares[roster.key], [name]: e.target.value },
                          })
                        }
                        aria-label={`Shares for ${name}`}
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="1"
                      />
                      {percent && <span className="loot-share-pct">{percent[j]}%</span>}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <button type="submit" className="party-save" disabled={busy || !ready}>
          {proposal && proposal.rows.length > 0
            ? `Sell ${proposal.rows.length === 1 ? "this drop" : `these ${proposal.rows.length}`}`
            : "Sell"}
        </button>

        {instead.length > 0 && <span className="split-error">Sell {instead.join(" or ")}.</span>}
        {refusal && <span className="split-error">{refusal}</span>}
      </form>

      {proposal && proposal.rows.length > 0 && (
        <ul className="ledger-queue">
          {proposal.rows.map((row, i) => {
            const boss = bossByKey.get(row.bossKey ?? "");
            const party = partyById.get(row.partyId);
            return (
              <li key={row.lootId} className="ledger-drop">
                <div className="ledger-drop-head">
                  <span className="loot-name">
                    {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                    {row.units > 1 && <span className="loot-count"> x{row.units}</span>}
                  </span>
                  <span className="loot-meta">
                    {/* Who ran it, but only where the card shows more than one set of boxes: with
                        two rosters on screen, nothing else says which one this row divides by. */}
                    {[
                      row.sellerName,
                      formatDropped(row.droppedOn),
                      rosters.length > 1 ? row.ran.map((s) => s.name).join(", ") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {amounts && (
                    <span className="lot-row-amount">{formatMesos(amounts[i] ?? 0, true)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
