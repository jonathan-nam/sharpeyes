"use client";

import { useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { formatMesos } from "@/lib/drop-split";
import { formatDollars, formatMoney } from "@/lib/money";
import type { SharedCard, SharedPart } from "@/lib/shared-book";

// Your side of other owners' books, read-only. Every write on a debt is the book owner's, so these
// cards carry no buttons: settling one is done with them, on their page. See lib/shared-book.ts.
export function SharedCards({ cards }: { cards: SharedCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Shared Parties</h2>
      {cards.map((card) => (
        <SharedCardView key={card.name} card={card} />
      ))}
    </section>
  );
}

function SharedCardView({ card }: { card: SharedCard }) {
  const { detail } = card;
  return (
    <section className="ledger-card">
      <header className="ledger-head">
        <span className="loot-title">
          <span className="loot-name">{card.name}</span>
          <span className="loot-meta ledger-summary is-open">
            {card.owed > 0 && (
              <CopyAmount value={card.owed} display={`${formatMesos(card.owed, true)} owed`} />
            )}
            {card.owe > 0 && <span>{`you owe ${formatMesos(card.owe, true)}`}</span>}
            {card.usd.owed > 0 && <span>{`${formatDollars(card.usd.owed)} owed`}</span>}
            {card.usd.owe > 0 && <span>{`you owe ${formatDollars(card.usd.owe)}`}</span>}
            {card.holding > 0 && (
              <span>{`holding ${formatMesos(card.holding, true)} of yours`}</span>
            )}
            {card.piecesOwed > 0 && <span>{`${card.piecesOwed} of your coupons`}</span>}
            {card.piecesOwe > 0 && <span>{`${card.piecesOwe} of their coupons`}</span>}
          </span>
        </span>
      </header>

      {(detail.owe.length > 0 || detail.paid.length > 0) && (
        <div className="ledger-pair">
          {detail.owe.length > 0 && (
            <Fold title="You Owe" amount={detail.oweTotal} rows={detail.owe} />
          )}
          {detail.paid.length > 0 && (
            <Fold title="Paid" amount={-detail.paidTotal} rows={detail.paid} negative />
          )}
        </div>
      )}

      {(detail.theyOwe.length > 0 || detail.holding > 0) && (
        <Fold
          title={`${card.name} Owes You`}
          rows={[
            ...detail.theyOwe.map((line) => ({
              key: `${line.lootId}:${line.theirsId}`,
              label: line.name,
              mesos: line.pay,
              money: formatMoney(line.pay, line.currency, true),
            })),
            ...(detail.holding > 0
              ? [{ key: "holding", label: "Your coupon sales they hold", mesos: detail.holding }]
              : []),
          ]}
        />
      )}
    </section>
  );
}

/** A heading with its chevron and total, folding the rows it is made of. SettlementCard's shape. */
function Fold({
  title,
  amount,
  rows,
  negative = false,
}: {
  title: string;
  amount?: number;
  rows: (SharedPart & { money?: string })[];
  negative?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const signed = (value: number) => `${value > 0 ? "+" : ""}${formatMesos(value, true)}`;
  return (
    <div className="ledger-entry">
      <div className="ledger-step-line">
        <span className="ledger-heading">{title}</span>
        <button
          type="button"
          className="party-row-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="party-row-chevron" aria-hidden="true" />
          <span className="visually-hidden">{open ? `Hide ${title}` : `Show ${title}`}</span>
        </button>
        {amount !== undefined && <span className="ledger-amount">{signed(amount)}</span>}
      </div>
      {open && (
        <ul className="ledger-queue">
          {rows.map((row) => (
            <li key={row.key} className="ledger-drop">
              <div className="ledger-drop-head">
                <span className="loot-name">{row.label}</span>
                <span className="ledger-amount">
                  {row.money ?? signed(negative ? -row.mesos : row.mesos)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
