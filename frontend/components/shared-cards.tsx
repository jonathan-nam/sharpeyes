"use client";

import { ChangedBy } from "@/components/changed-by";
import { formatPieces } from "@/lib/piece-ledger";
import { useCallback, useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { type ListingKit, ListingThumb, PostListingDialog } from "@/components/settlement-listing";
import { liveListing } from "@/lib/settlement-listings";
import type { SettlementListing } from "@/types/settlement-listing";
import {
  type ClosingAct,
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
  // You are the MEMBER here. Yours is for what the owner holds; theirs is for what you hold.
  const yourListing = listings
    ? liveListing(listings.listings, card.personId, "OWNER", card.held.byOwner)
    : null;
  const theirListing = listings
    ? liveListing(listings.listings, card.personId, "MEMBER", card.held.byYou)
    : null;
  /** Their listing beside the act that pays it: Mark Sent for your shares, else for their coupon money. */
  const withListingBeside = (listing: SettlementListing | null, acts: ClosingAct[]) => {
    const send = acts.findIndex((one) => one.key === "send");
    const at = send >= 0 ? send : acts.findIndex((one) => one.key === "paid");
    if (!listing || !listings || at < 0) return acts;
    return acts.map((one, i) =>
      i === at ? { ...one, after: <ListingThumb listing={listing} kit={listings} /> } : one,
    );
  };
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
    <section className="changed-by-anchor ledger-card">
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
        acts={withListingBeside(theirListing, [
          ...(card.youHold > 0
            ? [
                {
                  key: "offset",
                  label: `Take ${formatMesos(card.youHold, true)} Off Owed Amount`,
                  detail: heldFor,
                  onClick: () => act(writes.decide(card.personId, "OFFSET", card.youHold)),
                },
                {
                  key: "paid",
                  label: `Mark ${formatMesos(card.youHold, true)} Sent`,
                  detail: heldFor,
                  onClick: () => act(writes.decide(card.personId, "PAID", card.youHold)),
                },
              ]
            : []),
          ...(sendable.length > 0
            ? [
                {
                  key: "send",
                  label: `Mark ${formatMesos(sharesYouHold, true)} Sent`,
                  detail: listed(sendable.map((part) => part.label)),
                  onClick: () => act(sendAll()),
                },
              ]
            : []),
          ...(listings && card.held.byOwner > 0
            ? [
                yourListing
                  ? {
                      key: "listing",
                      after: (
                        <ListingThumb
                          listing={yourListing}
                          kit={listings}
                          onReplace={(image) =>
                            listings.post(card.personId, card.held.byOwner, image)
                          }
                        />
                      ),
                    }
                  : {
                      key: "listing",
                      label: `Post Listing for ${formatMesos(card.held.byOwner, true)}`,
                      onClick: () => setPosting(true),
                    },
              ]
            : []),
        ])}
      />

      {posting && listings && (
        <PostListingDialog
          amount={card.held.byOwner}
          onPost={(image) => listings.post(card.personId, card.held.byOwner, image)}
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
