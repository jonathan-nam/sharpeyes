"use client";

import { ChangedBy } from "@/components/changed-by";
import { formatPieces } from "@/lib/piece-ledger";
import { useEffect, useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { DiscordAvatar } from "@/components/discord-avatar";
import { ArmedRemove } from "@/components/settlement-ledger";
import { apiAssetUrl, failureText } from "@/lib/api";
import { formatMesos } from "@/lib/drop-split";
import { formatDollars, formatMoney } from "@/lib/money";
import type { SharedCard, SharedPart } from "@/lib/shared-book";

// Your side of other owners' books. Between two linked accounts the book is shared (V88): every figure
// is the owner's own, under the label turned round, and either of you writes into it. A row says who
// wrote it, and each of you takes back only your own. See lib/shared-book.ts.
//
// Laid out as the owner's card is (SettlementCard): the person and the figure on top, the history in
// a pop-up, and what stands open under Unsettled Amounts, each share under the side holding its money.

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

/** The coupon's art and name, for the coupon-sale rows. See vestigeOf. */
export type Coupon = { iconUrl: string | null; name: string | null };

export function SharedCards({
  cards,
  writes,
  coupon,
}: {
  cards: SharedCard[];
  writes: SharedWrites;
  coupon: Coupon;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Shared Parties</h2>
      {cards.map((card) => (
        <SharedCardView key={card.personId} card={card} writes={writes} coupon={coupon} />
      ))}
    </section>
  );
}

/** A drop's art, or the empty box the owner's card draws in its place. */
function Icon({ url }: { url: string | null | undefined }) {
  return url ? (
    <img className="loot-icon" src={apiAssetUrl(url)} alt="" />
  ) : (
    <span className="loot-icon" aria-hidden="true" />
  );
}

function SharedCardView({
  card,
  writes,
  coupon,
}: {
  card: SharedCard;
  writes: SharedWrites;
  coupon: Coupon;
}) {
  const { detail } = card;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (!showHistory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHistory(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHistory]);
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
  const sharesYouHold = sendable.reduce((sum, part) => sum + part.mesos, 0);
  const sharesTheyHold = detail.theyOwe
    .filter((line) => line.currency === "MESO")
    .reduce((sum, line) => sum + line.pay, 0);
  // Each half's figure: the shares whose money is in those hands, and the coupon money held.
  const youHold = card.youHold + sharesYouHold;
  const theyHold = detail.holding + sharesTheyHold;
  const couponLabel = (pieces: number) => `${formatPieces(pieces)} ${coupon.name ?? "coupons"}`;
  // What each closing act is about, beside its button. See the owner's card, SettlementCard.
  const heldPieces = card.youHoldSales.reduce((sum, sale) => sum + sale.pieces, 0);
  const heldFor = heldPieces > 0 ? couponLabel(heldPieces) : (coupon.name ?? "Coupons");
  const history =
    detail.owe.length > 0 || detail.paid.length > 0 || detail.theyOweEntered.length > 0;
  const open = youHold > 0 || theyHold > 0 || detail.theyOwe.length > 0;

  return (
    <section className="changed-by-anchor ledger-card">
      <ChangedBy topics={["settlement"]} matches={(t) => t.person === card.personId} />
      <header className="ledger-head">
        <span className="loot-name ledger-who is-large">
          <DiscordAvatar image={card.image} size="md" />
          {card.name}
        </span>
        <span className="loot-meta ledger-summary is-open">
          {card.owed > 0 && (
            <CopyAmount value={card.owed} display={`${formatMesos(card.owed, true)} owed`} />
          )}
          {card.owe > 0 && <span>{`you owe ${formatMesos(card.owe, true)}`}</span>}
          {card.usd.owed > 0 && <span>{`${formatDollars(card.usd.owed)} owed`}</span>}
          {card.usd.owe > 0 && <span>{`you owe ${formatDollars(card.usd.owe)}`}</span>}
          {card.piecesOwed > 0 && <span>{`${formatPieces(card.piecesOwed)} of your coupons`}</span>}
          {card.piecesOwe > 0 && <span>{`${formatPieces(card.piecesOwe)} of their coupons`}</span>}
        </span>
        {history && (
          <button
            type="button"
            className="party-cancel ledger-history-open"
            onClick={() => setShowHistory(true)}
          >
            History
          </button>
        )}
      </header>

      {showHistory && history && (
        <div className="invite-backdrop" role="presentation" onClick={() => setShowHistory(false)}>
          <div
            className="invite-dialog ledger-history"
            role="dialog"
            aria-modal="true"
            aria-label={`Settlement History with ${card.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="invite-title">Settlement History</h2>
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
            {detail.theyOweEntered.length > 0 && (
              <Fold title={`${card.name} Owes You`} rows={detail.theyOweEntered} {...controls} />
            )}
            <div className="invite-actions">
              <button type="button" className="party-cancel" onClick={() => setShowHistory(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="ledger-entry">
          <span className="ledger-heading">Unsettled Amounts</span>

          {youHold > 0 && (
            <div className="ledger-step-line">
              <span className="ledger-step">Held by You</span>
              <span className="ledger-amount">
                <CopyAmount value={youHold} display={formatMesos(youHold, true)} />
              </span>
            </div>
          )}
          {sendable.length > 0 && (
            <ul className="ledger-queue">
              {sendable.map((part) => (
                <li key={part.key} className="ledger-drop">
                  <div className="ledger-drop-head">
                    <Icon url={part.iconUrl} />
                    <span className="loot-name">{part.label}</span>
                    <span className="ledger-amount">{formatMesos(part.mesos, true)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {card.youHoldSales.length > 0 && (
            <ul className="loot-shares">
              {card.youHoldSales.map((sale, i) => (
                <li key={`${sale.trancheId}:${i}`} className="loot-sale-row">
                  <Icon url={coupon.iconUrl} />
                  <div className="ledger-offset-text">
                    <span className="loot-share-name">{couponLabel(sale.pieces)}</span>
                    <span className="ledger-offset-sub">
                      <span className="ledger-amount">{formatMesos(sale.mesos, true)}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(theyHold > 0 || detail.theyOwe.length > 0) && (
            <div className="ledger-step-line">
              <span className="ledger-step">{`Held by ${card.name}`}</span>
              {theyHold > 0 && (
                <span className="ledger-amount">
                  <CopyAmount value={theyHold} display={formatMesos(theyHold, true)} />
                </span>
              )}
            </div>
          )}
          {detail.theyOwe.length > 0 && (
            <ul className="ledger-queue">
              {detail.theyOwe.map((line) => (
                <li key={`${line.lootId}:${line.theirsId}`} className="ledger-drop">
                  <div className="ledger-drop-head">
                    <Icon url={line.iconUrl} />
                    <span className="loot-name">{line.name}</span>
                    <span className="ledger-amount">
                      {formatMoney(line.pay, line.currency, true)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {detail.holding > 0 && (
            <ul className="loot-shares">
              <li className="loot-sale-row">
                <Icon url={coupon.iconUrl} />
                <div className="ledger-offset-text">
                  <span className="loot-share-name">{coupon.name ?? "Coupons"}</span>
                  <span className="ledger-offset-sub">
                    <span className="ledger-amount">{formatMesos(detail.holding, true)}</span>
                  </span>
                </div>
              </li>
            </ul>
          )}
        </div>
      )}

      {(card.youHold > 0 || sendable.length > 0) && (
        <div className="ledger-entry">
          <span className="ledger-heading">Closing Actions</span>
          {card.youHold > 0 && (
            <>
              <span className="ledger-settle">
                <button
                  type="button"
                  className="party-save"
                  disabled={writes.busy}
                  onClick={() => act(writes.decide(card.personId, "OFFSET", card.youHold))}
                >
                  {`Take ${formatMesos(card.youHold, true)} Off Owed Amount`}
                </button>
                <span className="ledger-progress">{heldFor}</span>
              </span>
              <span className="ledger-settle">
                <button
                  type="button"
                  className="party-save"
                  disabled={writes.busy}
                  onClick={() => act(writes.decide(card.personId, "PAID", card.youHold))}
                >
                  {`Mark ${formatMesos(card.youHold, true)} Sent`}
                </button>
                <span className="ledger-progress">{heldFor}</span>
              </span>
            </>
          )}
          {sendable.length > 0 && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={writes.busy}
                onClick={() => act(sendAll())}
              >
                {`Mark ${formatMesos(sharesYouHold, true)} Sent`}
              </button>
              <span className="ledger-progress">{listed(sendable.map((part) => part.label))}</span>
            </span>
          )}
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}

/** At most three names, then how many more. */
function listed(items: string[]): string {
  return items.length <= 3
    ? items.join(", ")
    : `${items.slice(0, 3).join(", ")} and ${items.length - 3} more`;
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
