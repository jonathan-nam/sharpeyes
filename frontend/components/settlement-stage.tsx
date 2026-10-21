"use client";

import { AddSettlement } from "@/components/add-settlement";
import type { SharedWrites } from "@/components/shared-cards";
import { SettlementLedger } from "@/components/settlement-ledger";
import { SettlementSummary } from "@/components/settlement-summary";
import { keptOfYours } from "@/lib/settlement";
import { type SharedCard, withSharedCards } from "@/lib/shared-book";
import { type settlementView, vestigeOf } from "@/lib/settlement-view";
import {
  DEBTS_KEY,
  DISPOSALS_KEY,
  type DropLogWrites,
  PAYMENTS_KEY,
  SETTLEMENTS_KEY,
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
}: {
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
        shared={sharedCards.map((card) => ({ personId: card.personId, name: card.name }))}
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
        // Two acts, because a closure is one PILE's decision and the pair has two piles: their
        // nights close against them, yours against you. One button, since one handover finishes
        // both and closing a single side is what put the figure UP.
        //
        // Sequential, not parallel: each answers with the whole list and the last answer wins, so
        // racing them would redraw the card from whichever landed second.
        onSettlePair={async (holder: Holder, theirs, yours) => {
          if (theirs.length > 0) {
            await writes.settlementWrite(SETTLEMENTS_KEY, {
              method: "POST",
              // Nothing written off: a piece debt was never priced, so there is no shortfall to
              // record. What they sent is on the receipts.
              body: JSON.stringify({ holder, lootIds: theirs, unpaid: 0 }),
            });
          }
          if (yours.length > 0) {
            await writes.settlementWrite(SETTLEMENTS_KEY, {
              method: "POST",
              body: JSON.stringify({ holder: SELF_HOLDER, lootIds: yours, unpaid: 0 }),
            });
          }
        }}
        onSettleShares={writes.settleShares}
        onPin={async (row, pinned) => {
          if (row.holder.personId === null) return;
          await writes.pin(row.holder.personId, pinned);
        }}
        // ONE request, and one repaint. It was a settle followed by an entry per share, and the
        // halves of an offset cancel: between them the ledger said the shares were paid and nothing
        // had come off the debt, which walked Bro's card from 253.86b up to 254b and back down over
        // two round trips. A failure in the gap left it there.
        //
        // The coupon money is in the same request for the same reason one step out. It was a
        // disposal of its own after this one, and both come off what they owe you, so a press
        // covering the pair took Bro's card down by the shares and then down again by the money:
        // one button, one figure, two visible steps.
        //
        // The server writes all of it in one transaction and answers with every list, so there is
        // no order to get right here and no half of the act to leave behind. ONE ROW PER SHARE
        // still, so the history reads as the drops it was rather than as a figure naming nobody:
        // see writeClose.
        onOffsetAll={(holder: Holder, name, parts, holding) =>
          // Invisible on the card, which names the drop itself once an entry has one share behind
          // it. It is what the debt row says on its own.
          writes.closeWrite("offset", { holder, note: `offset against ${name}`, parts, holding })
        }
        // The same act pointed the other way, and one request for the same reason: the two pots it
        // moves are the two the Unsettled Amounts figure is made of.
        onSendAll={(holder: Holder, parts, holding) =>
          writes.closeWrite("sent", { holder, parts, holding })
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
