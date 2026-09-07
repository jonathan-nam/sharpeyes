"use client";

import { useState, type ReactNode } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { LootSaleForm } from "@/components/loot-sale-form";
import { apiAssetUrl } from "@/lib/api";
import { copyText, formatMoney } from "@/lib/money";
import { sharesLabel } from "@/lib/shares";
import { divides, formatDropped, saleMoney, splitOf, statusLabel } from "@/lib/loot";
import { canTrade, isPerMember } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Loot, SellLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

// One drop in the pool: what it is, what it sold for, and who is still owed.
//
// Every figure below comes from splitOf(), which calls splitDrop(). Nothing here divides anything.

export function LootRow({
  loot,
  party,
  boss,
  status,
  yours,
  pieces,
  couponRemovable = true,
  busy,
  onSell,
  onUnsell,
  onSetTaken,
  onSetPaid,
  onDelete,
  children,
}: {
  loot: Loot;
  party: Party;
  /** Named, not drawn: a pool is one boss and the page's title already carries its art. */
  boss: Boss | null;
  /**
   * What this row says it is, when the raw status cannot say.
   *
   * A piece drop never sells through its own row, so it is PENDING for ever and "In the pool" was what
   * every vestige stack read, whatever the tranche ledger said about it. Null is an ordinary drop,
   * whose status IS the answer. See dropStatusLabel.
   */
  status?: string | null;
  /**
   * Pieces of this drop that are YOURS, for a coupon row. Null for an ordinary drop.
   *
   * The count beside the name is what FELL, which is right for a pool: the party is holding 180 and the
   * controls below act on all of it. But the status beside it is about your share, so "x180 · Settled"
   * read as 180 of yours being settled when only 90 ever were. The Drop Log counts the same drop as
   * x90, deliberately, so each screen has to say which number it is showing.
   */
  yours?: number | null;
  /**
   * This drop is a stack of pieces, which does NOT sell through its own row. See isPieceDrop.
   *
   * It settles in tranches on the Drop Log, by COUNT. Selling it here would divide it as one pot of
   * MONEY while the piece ledger was still counting the same drop in coupons: two settlements for one
   * drop, which is the whole thing the ledger exists to prevent. The row was offering exactly that,
   * because it gates the sale on PENDING and a piece drop is PENDING for ever.
   */
  pieces?: boolean;
  /**
   * Whether a piece row offers Remove. Only a piece row reads it: every other row's Remove goes
   * with the sale controls beside it.
   *
   * False in the Party View panel, where the stack is what the split and the pickup under it are
   * about. The pool's own page keeps it, so a mis-logged stack can still be corrected.
   */
  couponRemovable?: boolean;
  busy: boolean;
  onSell: (body: SellLootBody) => void;
  onUnsell: () => void;
  onSetTaken: (memberId: string | null) => void;
  onSetPaid: (memberId: string, paid: boolean) => void;
  onDelete: () => void;
  /**
   * More about THIS drop, inside its own frame: the coupon row's pickup and the split it is read
   * against. Both used to follow the row as siblings, so a stack of coupons was a card with two
   * unframed blocks under it and the eye had nothing saying they belonged to it.
   */
  children?: ReactNode;
}) {
  const [selling, setSelling] = useState(false);
  // Who could have sold this drop: the seats that ran the week it FELL in. See LootSaleForm.
  const ran = party.seats.filter((m) => loot.ranThatWeek.includes(m.id));
  // A member buying it off the party is the same shape as a sale: they hold the value and owe
  // everyone else. So it is a third basis rather than a second form, and the only thing it changes
  // on screen is who the last select names.
  const bought = loot.amountBasis === "BOUGHT";
  // Only worth saying when it is not the whole stack. Zero counts: a party you keep the books for but
  // did not run is owed none of it, and "0 out of 180" is the honest way to say so.
  const share = yours !== null && yours !== undefined && yours !== loot.quantity ? yours : null;

  // Against every seat, not `ran`: a payout pinned before somebody left still names them, and
  // reading it against the week's roster would refuse a split that is perfectly readable.
  const result = splitOf(loot, party.seats);
  // Every figure on a sold row is in the sale's own unit, read off the split rather than assumed.
  // Mesos where nothing else is said, which is what an unsold row's absent figures were anyway.
  const currency = result?.currency ?? "MESO";
  const money = (value: number) => formatMoney(value, currency, true);
  const priced = saleMoney(loot);
  const sold = priced === null ? "" : formatMoney(priced.amount, priced.currency, true);
  // Silent in dollars, where the two methods are the same arithmetic and naming one states a
  // choice that was never offered. See the sale form.
  const splitWord =
    currency === "USD" ? "" : `, ${loot.splitMethod === "FAIR" ? "fair" : "lazy"} split`;
  // Heroic worlds do not trade. The row stays, because a Heroic player still logs what fell; what
  // goes is every control that would turn a drop into money. The backend refuses the sale too, so
  // this is what the rule looks like rather than the whole of it.
  const canSell = canTrade(party.worldType);
  // Everyone received their own copy, so the row has no pot and no holder. In Heroic that is every
  // piece drop there is; ordinary drops (a grindstone, a ring) still pool.
  const instanced = isPerMember(loot.perMember, party.worldType);

  return (
    <article className={`loot-row status-${loot.status.toLowerCase()}`}>
      <header className="loot-head">
        {loot.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(loot.iconUrl)} alt="" />
        ) : (
          // The drop has no official art (see catalog/drops.yaml). An empty frame keeps the row
          // aligned with the ones that do.
          <span className="loot-icon" aria-hidden="true" />
        )}
        <div className="loot-title">
          <span className="loot-name">
            {loot.name}
            {/* Your share OUT OF what fell, as one figure, where the two differ. Both numbers belong on
                a pool row (the party is holding all of it, and the status beside this is about your
                part) and "x180 90 yours" made the reader do the subtraction. A drop that came out even
                is already all yours, so it keeps the plain count rather than saying 180 out of 180. */}
            {share !== null ? (
              <span className="loot-count">
                {" "}
                {share} out of {loot.quantity}
              </span>
            ) : (
              loot.quantity > 1 && <span className="loot-count"> x{loot.quantity}</span>
            )}
          </span>
          <span className="loot-meta">
            {[boss?.name, formatDropped(loot.droppedOn)].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className={`loot-status is-${loot.status.toLowerCase()}`}>
          {status ?? statusLabel(loot.status)}
        </span>
      </header>

      {/* The mistake this whole app exists to prevent, in miniature: a drop everyone receives
          their own copy of is not one pot to divide. It used to hedge ("in Heroic/Reboot...")
          because the row did not know where it was; it does now, so it either applies or is not
          said.

          NOT gated on selling. `per_member: HEROIC` is true exactly where nothing sells, so pairing
          the two meant the one drop that most needed this never said it: a Heroic pool still shares
          out by hand, and a stack of 2 each was being taken by one seat. */}
      {instanced && <p className="loot-warn">Everyone gets their own. Nothing to split.</p>}

      {/* Where nothing sells, the question is who takes it. That is the whole of a Heroic pool's
          product: the item cannot move again, so which seat ends up with it is the only lever the
          party has, and one button per seat is the shortest way to pull it. Not offered on a solo
          pool, which has nobody to take turns with. */}
      {/* A piece row has no sale, so Remove is all it has: the pieces are priced on the Drop Log and
          everything else here would act on a pot that does not exist. Withheld where the row heads a
          config, which would go with it. See couponRemovable. */}
      {loot.status === "PENDING" && canSell && pieces && couponRemovable && (
        <div className="loot-actions">
          <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
            Remove
          </button>
        </div>
      )}

      {loot.status === "PENDING" && !canSell && (
        <div className="loot-actions">
          {/* Nobody takes an instanced drop: it is already in every inventory that ran, so naming
              a seat would hand the party's one copy to somebody when there was never one copy.
              divides() is master's better test for the other half of it, reading the seats that
              RAN rather than the config's solo flag. */}
          {divides(ran) &&
            !instanced &&
            ran.map((m) => (
              <button
                key={m.id}
                type="button"
                className="party-cancel"
                onClick={() => onSetTaken(m.id)}
                disabled={busy}
              >
                {m.name} took it
              </button>
            ))}
          <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
            Remove
          </button>
        </div>
      )}

      {loot.status === "TAKEN" && (
        <div className="loot-actions">
          <span className="loot-taken-by">
            {party.seats.find((m) => m.id === loot.takenByMemberId)?.name ??
              // The seat has left. Naming nobody beats naming the wrong person, and the row still
              // says the drop is spoken for.
              "Somebody no longer in the party"}
          </span>
          <button
            type="button"
            className="party-cancel"
            onClick={() => onSetTaken(null)}
            disabled={busy}
          >
            Put back
          </button>
          <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
            Remove
          </button>
        </div>
      )}

      {loot.status === "PENDING" &&
        canSell &&
        !pieces &&
        (selling ? (
          <LootSaleForm
            ran={ran}
            busy={busy}
            onSell={(body) => {
              onSell(body);
              setSelling(false);
            }}
            onCancel={() => setSelling(false)}
          />
        ) : (
          <div className="loot-actions">
            <button
              type="button"
              className="party-save"
              onClick={() => setSelling(true)}
              disabled={busy}
            >
              Mark sold
            </button>
            <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
              Remove
            </button>
          </div>
        ))}

      {/* Sold, which TAKEN is not: it has no pot, no seller and no payout roster, so splitOf would
          refuse it and the row would read "this sale names somebody who is no longer in the party"
          about a drop that was never sold. */}
      {loot.status !== "PENDING" && loot.status !== "TAKEN" && (
        <>
          {result === null ? (
            // splitOf refuses when a seat it needs is missing. Saying so beats drawing a payout
            // list that is short a person.
            <p className="loot-warn">
              This sale names somebody who is no longer in the party, so the split cannot be shown.
            </p>
          ) : (
            <>
              {/* The buyer keeps the item, not the mesos, so "they keep" would be naming the wrong
                  thing. The figure is the same one either way: their own share of the pot.

                  Their share and what they hand over add up to the price. Both are here because a
                  payout on its own reads as more than a share of it, being grossed up for the 5%
                  its receiver pays. */}
              {bought ? (
                <p className="loot-sold-line">
                  Bought by {result.seller.name} for <strong>{sold}</strong>
                  {splitWord}. Their share
                  {result.seller.shares === 1 ? " is" : ` (${result.seller.shares} shares) is`}{" "}
                  <strong>{money(result.seller.keeps)}</strong>, and they hand over{" "}
                  <strong>{money(result.seller.paysOut)}</strong>.
                </p>
              ) : (
                <p className="loot-sold-line">
                  {loot.amountBasis === "LISTED" ? "Listed at" : "Received"} <strong>{sold}</strong>{" "}
                  by {result.seller.name}
                  {splitWord}. They keep <strong>{money(result.seller.keeps)}</strong>
                  {result.seller.shares === 1 ? "" : ` on ${result.seller.shares} shares`}.
                </p>
              )}

              <ul className="loot-shares">
                {result.shares.map((share) => (
                  <li key={share.memberId} className={share.paid ? "is-paid" : undefined}>
                    <span className="loot-share-name">{share.name}</span>
                    {/* The raw digits, because this gets pasted into the game's price box, or into
                        whatever is moving the dollars. See copyText. */}
                    <CopyAmount
                      value={share.pay}
                      display={money(share.pay)}
                      copy={copyText(share.pay, result.currency)}
                    />
                    {/* What the fee costs, where there is one. A dollar sale pays none, so the same
                        span would read "nets $333.34 at 0%": the pay figure again, and a rate
                        stated only to say it did not apply. */}
                    <span className="loot-share-nets">
                      {share.fee > 0 &&
                        `nets ${money(share.nets)} at ${(share.fee * 100).toFixed(0)}%`}
                      {share.fee > 0 && sharesLabel(share.shares) && " \u00b7 "}
                      {sharesLabel(share.shares)}
                    </span>
                    {/* A TOGGLE, and the paid state has to look like one. It read "paid" in a green
                        pill, which is what a status badge looks like, so undoing a share marked paid
                        by mistake was not discoverable at all: the one click anybody found flipped
                        it back. The x is this app's own undo mark, the same one a tranche row and an
                        entered debt carry. */}
                    <button
                      type="button"
                      className={share.paid ? "loot-paid is-paid" : "loot-paid"}
                      onClick={() => onSetPaid(share.memberId, !share.paid)}
                      disabled={busy}
                      aria-label={
                        share.paid ? `Mark ${share.name} unpaid` : `Mark ${share.name} paid`
                      }
                    >
                      {share.paid ? "paid \u00d7" : "mark paid"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="loot-actions">
            <button type="button" className="party-cancel" onClick={onUnsell} disabled={busy}>
              Undo sale
            </button>
            <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
              Remove
            </button>
          </div>
        </>
      )}

      {/* Last, under everything the row says about itself. */}
      {children}
    </article>
  );
}
