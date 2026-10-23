"use client";

import { ChangedBy } from "@/components/changed-by";
import { formatPieces } from "@/lib/piece-ledger";
import { useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { DiscordAvatar } from "@/components/discord-avatar";
import { ArmedRemove } from "@/components/settlement-ledger";
import { failureText } from "@/lib/api";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import { formatDollars, formatMoney } from "@/lib/money";
import type { SharedCard, SharedPart } from "@/lib/shared-book";

// Your side of other owners' books. Between two linked accounts the book is shared (V88): every figure
// is the owner's own, under the label turned round, and either of you writes into it. A row says who
// wrote it, and each of you takes back only your own. See lib/shared-book.ts.

/** What a card can write into the book it reads. Each answers once the page has read it back. */
export type SharedWrites = {
  busy: boolean;
  /** POST /api/shared-books/{personId}/{debts|payments}. */
  add: (
    personId: string,
    kind: "debts" | "payments",
    amount: number,
    note: string,
  ) => Promise<void>;
  remove: (personId: string, kind: "debts" | "payments" | "disposals", id: string) => Promise<void>;
  /** What became of their money you hold: off what they owe you, or sent. See V91. */
  decide: (personId: string, kind: "OFFSET" | "PAID", amount: number) => Promise<void>;
  /** Marks a share of a drop you sold as sent. */
  send: (to: NonNullable<SharedPart["send"]>) => Promise<void>;
};

export function SharedCards({ cards, writes }: { cards: SharedCard[]; writes: SharedWrites }) {
  if (cards.length === 0) return null;
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Shared Parties</h2>
      {cards.map((card) => (
        <SharedCardView key={card.personId} card={card} writes={writes} />
      ))}
    </section>
  );
}

function SharedCardView({ card, writes }: { card: SharedCard; writes: SharedWrites }) {
  const { detail } = card;
  const [refusal, setRefusal] = useState<string | null>(null);
  const act = (action: Promise<void>) => {
    setRefusal(null);
    action.catch((e) => setRefusal(failureText(e, "That didn't save. Try again.")));
  };
  const controls = {
    busy: writes.busy,
    onRemove: (part: SharedPart) =>
      part.remove && act(writes.remove(card.personId, part.remove.kind, part.remove.id)),
  };
  // Every share of a drop you sold that you still owe, sent in one press rather than one per drop.
  // One at a time: each answers with the whole book, and racing them redraws off the last to land.
  const sendable = detail.owe.flatMap((part) => (part.send ? [part] : []));
  const sendAll = async () => {
    for (const part of sendable) await writes.send(part.send!);
  };
  return (
    <section className="changed-by-anchor ledger-card">
      <ChangedBy topics={["settlement"]} matches={(t) => t.person === card.personId} />
      <header className="ledger-head">
        <span className="loot-title">
          <span className="loot-name ledger-who">
            <DiscordAvatar image={card.image} size="sm" />
            {card.name}
          </span>
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
            {card.youHold > 0 && (
              <CopyAmount
                value={card.youHold}
                display={`you hold ${formatMesos(card.youHold, true)} of theirs`}
              />
            )}
            {card.piecesOwed > 0 && (
              <span>{`${formatPieces(card.piecesOwed)} of your coupons`}</span>
            )}
            {card.piecesOwe > 0 && (
              <span>{`${formatPieces(card.piecesOwe)} of their coupons`}</span>
            )}
          </span>
        </span>
      </header>

      {(detail.owe.length > 0 || detail.paid.length > 0) && (
        <div className="ledger-pair">
          {detail.owe.length > 0 && (
            <Fold title="You Owe" amount={detail.oweTotal} rows={detail.owe} {...controls} />
          )}
          {detail.paid.length > 0 && (
            <Fold
              title="Paid"
              amount={-detail.paidTotal}
              rows={detail.paid}
              negative
              {...controls}
            />
          )}
        </div>
      )}

      {(detail.theyOwe.length > 0 || detail.theyOweEntered.length > 0 || detail.holding > 0) && (
        <Fold
          title={`${card.name} Owes You`}
          rows={[
            ...detail.theyOwe.map((line) => ({
              key: `${line.lootId}:${line.theirsId}`,
              label: line.name,
              mesos: line.pay,
              money: formatMoney(line.pay, line.currency, true),
            })),
            ...detail.theyOweEntered,
            ...(detail.holding > 0
              ? [{ key: "holding", label: "Your coupon sales they hold", mesos: detail.holding }]
              : []),
          ]}
          {...controls}
        />
      )}

      {/* Their money from your sale of their coupons, until one of you says which: off what they
          owe you, or sent. See V91. */}
      {card.youHold > 0 && (
        <div className="loot-actions">
          <button
            type="button"
            className="party-save"
            disabled={writes.busy}
            onClick={() => act(writes.decide(card.personId, "OFFSET", card.youHold))}
          >
            {`Take ${formatMesos(card.youHold, true)} Off Owed Amount`}
          </button>
          <button
            type="button"
            className="party-save"
            disabled={writes.busy}
            onClick={() => act(writes.decide(card.personId, "PAID", card.youHold))}
          >
            {`Mark ${formatMesos(card.youHold, true)} Sent`}
          </button>
        </div>
      )}

      {sendable.length > 0 && (
        <button
          type="button"
          className="party-save"
          disabled={writes.busy}
          onClick={() => act(sendAll())}
        >
          {`Mark ${formatMesos(
            sendable.reduce((sum, part) => sum + part.mesos, 0),
            true,
          )} Sent`}
        </button>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}

/** A heading with its chevron and total, folding the rows it is made of. SettlementCard's shape. */
function Fold({
  title,
  amount,
  rows,
  negative = false,
  busy,
  onRemove,
}: {
  title: string;
  amount?: number;
  rows: (SharedPart & { money?: string })[];
  negative?: boolean;
  busy: boolean;
  onRemove: (part: SharedPart) => void;
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
                <span className="loot-name">
                  {row.label}
                  {row.by && <span className="loot-meta"> · {row.by}</span>}
                </span>
                <span className="ledger-amount">
                  {row.money ?? signed(negative ? -row.mesos : row.mesos)}
                </span>
                {row.remove && (
                  <ArmedRemove
                    label={`Remove ${row.label}`}
                    busy={busy}
                    onRemove={() => onRemove(row)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
