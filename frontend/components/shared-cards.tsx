"use client";

import { CopyAmount } from "@/components/copy-amount";
import { formatMesos } from "@/lib/drop-split";
import { formatDollars } from "@/lib/money";
import type { SharedCard } from "@/lib/shared-book";

// Your side of other owners' books, read-only. Every write on a debt is the book owner's, so these
// cards carry no buttons: settling one is done with them, on their page. See lib/shared-book.ts.
export function SharedCards({ cards }: { cards: SharedCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Shared Parties</h2>
      {cards.map((card) => (
        <section key={card.name} className="ledger-card">
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
        </section>
      ))}
    </section>
  );
}
