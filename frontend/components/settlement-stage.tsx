"use client";

import { AddSettlement } from "@/components/add-settlement";
import type { SharedWrites } from "@/components/shared-cards";
import { SettlementLedger } from "@/components/settlement-ledger";
import type { ListingKit } from "@/components/settlement-listing";
import { SettlementSummary } from "@/components/settlement-summary";
import { keptOfYours } from "@/lib/settlement";
import { type SharedCard, withSharedCards } from "@/lib/shared-book";
import { type settlementView, vestigeOf } from "@/lib/settlement-view";
import {
  DEBTS_KEY,
  DISPOSALS_KEY,
  type DropLogWrites,
  PAYMENTS_KEY,
  TRANCHES_KEY,
} from "@/lib/use-drop-log-writes";
import { type Holder, paymentsSinceClosing, SELF_HOLDER } from "@/lib/vestige-ledger";
import type { DropLogPage } from "@/types/page";

/**
 * The Drop Log's Settlement stage, whole: the tiles, the entry boxes and every card's acts.
 *
 * Any other screen that offers these acts should draw this rather than its own, so an Offset is one
 * write with one set of figures in front of it wherever it is pressed.
 */
export function SettlementStage({
  page,
  view,
  writes,
  sharedOwners = [],
  sharedCards = [],
  onShared,
  listings,
}: {
  /** Auction house listings on the linked cards. See components/settlement-listing.tsx. */
  listings?: ListingKit;
  page: Pick<
    DropLogPage,
    "parties" | "bosses" | "people" | "tranches" | "payments" | "settlements" | "drops"
  >;
  view: ReturnType<typeof settlementView>;
  writes: DropLogWrites;
  /**
   * Your people whose account keeps a shared book with you. Their debts and payments go into that
   * book rather than yours, through `sharedCards`. See ownBookRefusal.
   */
  sharedOwners?: string[];
  /** Your cards in other owners' books: counted in the tiles, and offered by the boxes. */
  sharedCards?: SharedCard[];
  onShared?: SharedWrites["add"];
}) {
  const { settlement, totals, wallet, offsetShares } = view;
  const { busy } = writes;
  const bossByKey = new Map(page.bosses.map((b) => [b.bossKey, b]));
  const partyById = new Map(page.parties.map((p) => [p.id, p]));
  const vestige = vestigeOf(page.drops);
  // Split by the same line the money is netted against, so a receipt a closure already spent is
  // never a row in the arithmetic that no longer counts it. See Receipts.
  const paymentsByHolder = paymentsSinceClosing(page.payments, page.settlements);

  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Settlement Summary</h2>

      <SettlementSummary totals={withSharedCards(totals, sharedCards)} />

      {/* The two boxes, above the cards they write to and out of every one of them. A card names its
          person, so the boxes inside one did not have to; out here the picker does, and it offers
          the unclaimed characters a card can be keyed by as well as the people list. */}
      <AddSettlement
        people={page.people.filter((person) => !sharedOwners.includes(person.id))}
        holders={settlement
          .filter((row) => !sharedOwners.some((id) => row.key === `person:${id}`))
          .map((row) => ({
            key: row.key,
            name: row.name,
            holder: row.holder,
          }))}
        busy={busy}
        onAddDebt={(holder: Holder, amount, note) =>
          writes.debtWrite(DEBTS_KEY, {
            method: "POST",
            body: JSON.stringify({ holder, amount, note: note || undefined }),
          })
        }
        onAddPayment={(holder: Holder, amount, note) =>
          writes.paymentWrite(PAYMENTS_KEY, {
            method: "POST",
            body: JSON.stringify({ holder, amount, note: note || undefined }),
          })
        }
        shared={sharedCards.map((card) => ({
          personId: card.personId,
          name: card.name,
          image: card.image,
        }))}
        onShared={onShared}
      />

      <SettlementLedger
        rows={settlement}
        images={
          new Map(
            page.people.flatMap((person) =>
              person.image ? [[`person:${person.id}`, person.image] as const] : [],
            ),
          )
        }
        linked={
          new Set(page.people.flatMap((person) => (person.linked ? [`person:${person.id}`] : [])))
        }
        listings={listings}
        bossByKey={bossByKey}
        partyById={partyById}
        offsetShares={offsetShares}
        iconUrl={vestige?.iconUrl ?? null}
        couponName={vestige?.name ?? null}
        busy={busy}
        // Every payment, not only the ones counted since closing: these are the rows as typed, and
        // one entered against a closed boss is still one somebody may need back.
        payments={paymentsByHolder}
        // The two ENTRY boxes are the card above's, keyed by a picker. What stays here is taking a
        // row back off, which can only be done where the row is drawn.
        onRemovePayment={(paymentId) =>
          writes.paymentWrite(`${PAYMENTS_KEY}/${paymentId}`, { method: "DELETE" })
        }
        onRemoveDebt={(debtId) => writes.debtWrite(`${DEBTS_KEY}/${debtId}`, { method: "DELETE" })}
        // Their pile, their purchase: they are keeping coupons that were yours and paying for them.
        // V50's act with the sides swapped, which is why it needs no new shape. The tranche prices
        // the pieces (they stop being a count) and puts the money on this card as `soldOfYours`,
        // which comes off what you owe them.
        //
        // An ACT and never a netting. Their coupons only come off your debt if they agree to that,
        // and they may want the mesos instead.
        keptRows={keptOfYours(page.tranches)}
        // What becomes of their money you are holding is decided by the closing acts below, in the
        // same write as the shares: see closeWrite. Only taking a decision back off is its own
        // request, being its own act. See V61.
        onRemoveDisposal={(disposalId) =>
          writes.disposalWrite(`${DISPOSALS_KEY}/${disposalId}`, { method: "DELETE" })
        }
        onKeepPieces={(holder: Holder, pieces, amount) =>
          writes.saleWrite(TRANCHES_KEY, {
            method: "POST",
            body: JSON.stringify({
              holder,
              pieces,
              amount,
              disposition: "BOUGHT",
              shares: [{ holder: SELF_HOLDER, pieces }],
            }),
          })
        }
        onRemoveKeep={(trancheId) =>
          writes.saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" })
        }
        onSettleShares={writes.settleShares}
        onPin={async (row, pinned) => {
          if (row.holder.personId === null) return;
          await writes.pin(row.holder.personId, pinned);
        }}
        // ONE request, and one repaint, for every pot the press settles both ways: the halves of an
        // offset cancel, and as separate requests the card drew between them (Owen's card walked
        // from 253.86b up to 254b and back). The server writes it in one transaction, one entry per
        // share so the history reads as the drops it was: see writeClose.
        onClose={(holder: Holder, name, kind, pots) =>
          kind === "OFFSET"
            ? // The debt row's own words; the card names the drop once an entry has one behind it.
              writes.closeWrite("offset", { holder, note: `offset against ${name}`, ...pots })
            : writes.closeWrite("sent", { holder, ...pots })
        }
      />

      {/* What the cards above do NOT cover, from the Wallet this tab replaced. A total that is short
          must not read as a total that is complete. */}
      {(wallet.unreadable > 0 || wallet.betweenMine > 0) && (
        <ul className="ledger-notes">
          {wallet.unreadable > 0 && (
            <li className="loot-warn">
              {wallet.unreadable} sold {wallet.unreadable === 1 ? "drop" : "drops"} unreadable, not
              counted above.
            </li>
          )}
          {wallet.betweenMine > 0 && (
            <li>
              {wallet.betweenMine} {wallet.betweenMine === 1 ? "share" : "shares"} between your own
              characters.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
