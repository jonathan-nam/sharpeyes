"use client";

import { ChangedBy } from "@/components/changed-by";
import { formatPieces } from "@/lib/piece-ledger";
import { useCallback, useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { type ListingKit, PostListingDialog } from "@/components/settlement-listing";
import { liveListing, paysOn } from "@/lib/settlement-listings";
import { cardAnchor } from "@/lib/drop-sections";
import { type CloseKind, closeBody, closingActs } from "@/components/closing-acts";
import { flipNet } from "@/lib/settlement";
import type { ClosePots } from "@/types/vestige";
import {
  ClosingActions,
  CouponTotal,
  HeldBy,
  HistoryDialog,
  LedgerHead,
  ShareRows,
  UnsettledAmounts,
} from "@/components/ledger-card";
import { ArmedRemove } from "@/components/settlement-ledger";
import { failureText } from "@/lib/api";
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
  /** One closing act, in the owner's terms: POST /api/shared-books/{personId}/close/{kind}. */
  close: (personId: string, kind: CloseKind, pots: ClosePots) => Promise<void>;
};

/** The coupon's art and name, for the coupon-sale rows. See vestigeOf. */
export type Coupon = { iconUrl: string | null; name: string | null };

export function SharedCards({
  cards,
  writes,
  coupon,
  listings,
}: {
  cards: SharedCard[];
  writes: SharedWrites;
  coupon: Coupon;
  listings?: ListingKit;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Shared Parties</h2>
      {cards.map((card) => (
        <SharedCardView
          key={card.personId}
          card={card}
          writes={writes}
          coupon={coupon}
          listings={listings}
        />
      ))}
    </section>
  );
}

function SharedCardView({
  card,
  writes,
  coupon,
  listings,
}: {
  card: SharedCard;
  writes: SharedWrites;
  coupon: Coupon;
  listings?: ListingKit;
}) {
  const { detail } = card;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // You are the MEMBER here, and `card.net` is read from your side. Yours is posted for the owner to
  // pay (they owe net); theirs for you to pay (you owe net).
  const listingFor = (payer: "OWNER" | "MEMBER") =>
    listings
      ? liveListing(listings.listings, card.personId, payer, paysOn(card.net, "MEMBER", payer))
      : null;
  const yourListing = listingFor("OWNER");
  const theirListing = listingFor("MEMBER");
  /** One press, sent in the owner's terms: the net turned back round. See closeShared. */
  const close = (kind: CloseKind) =>
    act(writes.close(card.personId, kind, closeBody(flipNet(card.net), kind)));
  const [showHistory, setShowHistory] = useState(false);
  const closeHistory = useCallback(() => setShowHistory(false), []);
  const act = (action: Promise<void>) => {
    setRefusal(null);
    action.catch((e) => setRefusal(failureText(e, "That didn't save. Try again.")));
  };
  const controls = {
    busy: writes.busy,
    onRemove: (part: SharedPart) =>
      part.remove && act(writes.remove(card.personId, part.remove.kind, part.remove.id)),
  };
  // Every share of a drop you sold that you still owe: money of theirs in your hands.
  const sendable = detail.owe.flatMap((part) => (part.send ? [part] : []));
  const sharesYouHold = sendable.reduce((sum, part) => sum + part.mesos, 0);
  const sharesTheyHold = detail.theyOwe
    .filter((line) => line.currency === "MESO")
    .reduce((sum, line) => sum + line.pay, 0);
  // Each half's figure: the shares whose money is in those hands, and the coupon money held.
  const youHold = card.youHold + sharesYouHold;
  const theyHold = detail.holding + sharesTheyHold;
  // What each closing act is about, beside its button. See the owner's card, SettlementCard.
  const heldPieces = card.youHoldSales.reduce((sum, sale) => sum + sale.pieces, 0);
  const heldFor =
    heldPieces > 0
      ? `${formatPieces(heldPieces)} ${coupon.name ?? "coupons"}`
      : (coupon.name ?? "Coupons");
  const history =
    detail.owe.length > 0 || detail.paid.length > 0 || detail.theyOweEntered.length > 0;
  const open = youHold > 0 || theyHold > 0 || detail.theyOwe.length > 0;

  return (
    <section className="changed-by-anchor ledger-card" id={cardAnchor(card.personId)}>
      <ChangedBy topics={["settlement"]} matches={(t) => t.person === card.personId} />
      <LedgerHead
        image={card.image}
        name={card.name}
        onHistory={history ? () => setShowHistory(true) : undefined}
        summary={
          <>
            {card.owed > 0 && (
              <CopyAmount value={card.owed} display={`${formatMesos(card.owed, true)} owed`} />
            )}
            {card.owe > 0 && <span>{`you owe ${formatMesos(card.owe, true)}`}</span>}
            {card.usd.owed > 0 && <span>{`${formatDollars(card.usd.owed)} owed`}</span>}
            {card.usd.owe > 0 && <span>{`you owe ${formatDollars(card.usd.owe)}`}</span>}
            {card.piecesOwed > 0 && (
              <span>{`${formatPieces(card.piecesOwed)} of your coupons`}</span>
            )}
            {card.piecesOwe > 0 && (
              <span>{`${formatPieces(card.piecesOwe)} of their coupons`}</span>
            )}
          </>
        }
      />

      {showHistory && history && (
        <HistoryDialog name={card.name} onClose={closeHistory}>
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
        </HistoryDialog>
      )}

      {open && (
        <UnsettledAmounts>
          {(youHold > 0 || sendable.length > 0) && (
            <HeldBy label="Held by You" mesos={youHold}>
              <ShareRows
                lines={sendable.map((part) => ({
                  key: part.key,
                  iconUrl: part.iconUrl,
                  name: part.label,
                  money: formatMesos(part.mesos, true),
                }))}
              />
              <CouponTotal
                sales={card.youHoldSales}
                iconUrl={coupon.iconUrl}
                couponName={coupon.name}
              />
            </HeldBy>
          )}
          {(theyHold > 0 || detail.theyOwe.length > 0) && (
            <HeldBy label={`Held by ${card.name}`} mesos={theyHold}>
              <ShareRows
                lines={detail.theyOwe.map((line) => ({
                  key: `${line.lootId}:${line.theirsId}`,
                  iconUrl: line.iconUrl,
                  name: line.name,
                  money: formatMoney(line.pay, line.currency, true),
                }))}
              />
              <CouponTotal
                sales={card.holdingSales}
                iconUrl={coupon.iconUrl}
                couponName={coupon.name}
              />
            </HeldBy>
          )}
        </UnsettledAmounts>
      )}

      <ClosingActions
        busy={writes.busy}
        acts={closingActs({
          net: card.net,
          name: card.name,
          // Every share both ways and the coupon money: everything one press settles.
          detail: listed([
            ...sendable.map((part) => part.label),
            ...detail.theyOwe.map((line) => line.name),
            ...(card.youHold > 0 ? [heldFor] : []),
          ]),
          close,
          listings: listings
            ? {
                kit: listings,
                yours: yourListing,
                theirs: theirListing,
                post: () => setPosting(true),
                replace: (image) =>
                  listings.post(card.personId, paysOn(card.net, "MEMBER", "OWNER"), image),
                remove: () => {
                  if (yourListing) act(listings.remove(yourListing.id));
                },
              }
            : undefined,
        })}
      />

      {posting && listings && (
        <PostListingDialog
          amount={paysOn(card.net, "MEMBER", "OWNER")}
          onPost={(image) =>
            listings.post(card.personId, paysOn(card.net, "MEMBER", "OWNER"), image)
          }
          onClose={() => setPosting(false)}
        />
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
