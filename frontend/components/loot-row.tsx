"use client";

import { useState, type ReactNode } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { apiAssetUrl } from "@/lib/api";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import { parseShares, sharesLabel } from "@/lib/shares";
import { formatDropped, splitOf, statusLabel } from "@/lib/loot";
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
  const [price, setPrice] = useState("");
  const [amountBasis, setAmountBasis] = useState("LISTED");
  const [splitMethod, setSplitMethod] = useState("FAIR");
  // Who could have sold this drop: the seats that ran the week it FELL in, not the party as it
  // stands now. Offering more than that would offer a seller the sell route refuses, and offering
  // the week's roster for a guest week is the only way to name the guest who actually sold it.
  const ran = party.seats.filter((m) => loot.ranThatWeek.includes(m.id));
  // Whoever picked it up is who is holding it, so they are the seller unless somebody says
  // otherwise. A recorded fact (V64) rather than the first seat in the roster, which named an
  // arbitrary person as seller and so set which way the debt ran.
  const looted = ran.find((m) => m.id === loot.looterMemberId)?.id;
  const [sellerMemberId, setSellerMemberId] = useState(looted ?? ran[0]?.id ?? "");
  const [selling, setSelling] = useState(false);
  // Every seat opens on one share, and an uneven split is typed here. It used to be seeded from
  // `party_member.shares`, which is the STACK entitlement the party config's boxes write: a duo
  // splitting three vestige stacks 1 and 2 had every ring and grindstone they ever sold open at
  // 1:2. That ratio divides the coupon pile and nothing else, which is ranSeats' job, not this one.
  const [shares, setShares] = useState<Record<string, string>>({});
  const shareOf = (memberId: string) => shares[memberId] ?? "1";
  const entered = ran.map((m) => parseShares(shareOf(m.id)));
  const sharesReadable = entered.every((count) => count !== null);
  // A member buying it off the party is the same shape as a sale: they hold the value and owe
  // everyone else. So it is a third basis rather than a second form, and the only thing it changes
  // on screen is who the last select names.
  const bought = loot.amountBasis === "BOUGHT";
  // Only worth saying when it is not the whole stack. Zero counts: a party you keep the books for but
  // did not run is owed none of it, and "0 out of 180" is the honest way to say so.
  const share = yours !== null && yours !== undefined && yours !== loot.quantity ? yours : null;

  const amount = parseMesos(price);
  // Against every seat, not `ran`: a payout pinned before somebody left still names them, and
  // reading it against the week's roster would refuse a split that is perfectly readable.
  const result = splitOf(loot, party.seats);
  // Heroic worlds do not trade. The row stays, because a Heroic player still logs what fell; what
  // goes is every control that would turn a drop into money. The backend refuses the sale too, so
  // this is what the rule looks like rather than the whole of it.
  const canSell = canTrade(party.worldType);

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
          said. Only where there is splitting to warn off: in a Heroic pool nothing splits anyway. */}
      {canSell && isPerMember(loot.perMember, party.worldType) && (
        <p className="loot-warn">Everyone gets their own. Nothing to split.</p>
      )}

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
          {!party.solo &&
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
          <form
            className="loot-sale-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount === null || !sellerMemberId || !sharesReadable) return;
              onSell({
                amount,
                amountBasis,
                splitMethod,
                sellerMemberId,
                shares: Object.fromEntries(ran.map((m, i) => [m.id, entered[i] ?? 1])),
              });
              setSelling(false);
            }}
          >
            <div className="loot-sale-line">
              <input
                className="split-input"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="9.5b"
                aria-label="Sale amount"
                inputMode="decimal"
              />
              <select
                className="split-input"
                value={amountBasis}
                onChange={(e) => setAmountBasis(e.target.value)}
                aria-label="What that amount is"
              >
                <option value="LISTED">listed for</option>
                <option value="RECEIVED">received</option>
                {/* No listing, so no Auction House cut off the top: the price is the whole pot.
                    The payouts are still taxed, so the split is the same one. Not offered on a
                    solo pool: there is no party for a member to buy it off. */}
                {!party.solo && <option value="BOUGHT">member bought</option>}
              </select>
              {/* Neither control is a question on a solo pool: one seat means nobody to divide
                  with and nobody else it could have been sold by. The stored method is whichever
                  the state holds, and with no members splitDrop's two branches are the same
                  arithmetic (see the test). */}
              {!party.solo && (
                <select
                  className="split-input"
                  value={splitMethod}
                  onChange={(e) => setSplitMethod(e.target.value)}
                  aria-label="Split method"
                >
                  {/* Both are offered for the reason lib/drop-split.ts gives: "lazy" is what most
                      parties do, and only showing "fair" would hide what it costs. */}
                  <option value="FAIR">fair split</option>
                  <option value="LAZY">lazy split</option>
                </select>
              )}
              {!party.solo && (
                <select
                  className="split-input"
                  value={sellerMemberId}
                  onChange={(e) => setSellerMemberId(e.target.value)}
                  aria-label={amountBasis === "BOUGHT" ? "Who bought it" : "Who sold it"}
                >
                  {ran.map((m) => (
                    <option key={m.id} value={m.id}>
                      {amountBasis === "BOUGHT" ? "bought by" : "sold by"} {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* One box per seat that ran, so an uneven split is typed where the sale is. Not on a
                solo pool, which has nobody to divide with. */}
            {!party.solo && (
              <div className="loot-share-inputs">
                {ran.map((m) => (
                  <span key={m.id} className="loot-share-input">
                    <span className="loot-share-name">{m.name}</span>
                    <input
                      className="split-input loot-count-input"
                      value={shareOf(m.id)}
                      onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })}
                      aria-label={`Shares for ${m.name}`}
                      inputMode="numeric"
                      maxLength={2}
                    />
                  </span>
                ))}
              </div>
            )}

            <div className="loot-actions">
              {/* Without a seller there is nobody to measure the shares against, and the submit
                  would return without saying so. */}
              <button
                type="submit"
                className="party-save"
                disabled={busy || amount === null || !sellerMemberId || !sharesReadable}
              >
                Save sale
              </button>
              <button
                type="button"
                className="party-cancel"
                onClick={() => setSelling(false)}
                disabled={busy}
              >
                Cancel
              </button>
              {/* Shown before saving, so a typed "9.5b" is confirmed as 9,500,000,000 rather than
                  discovered afterwards. */}
              {price !== "" && (
                <span className="loot-parsed">
                  {amount === null ? "not a price" : formatMesos(amount, true)}
                </span>
              )}
            </div>
          </form>
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
                  Bought by {result.seller.name} for{" "}
                  <strong>{formatMesos(loot.saleAmount ?? 0, true)}</strong>,{" "}
                  {loot.splitMethod === "FAIR" ? "fair" : "lazy"} split. Their share
                  {result.seller.shares === 1 ? " is" : ` (${result.seller.shares} shares) is`}{" "}
                  <strong>{formatMesos(result.seller.keeps, true)}</strong>, and they hand over{" "}
                  <strong>{formatMesos(result.seller.paysOut, true)}</strong>.
                </p>
              ) : (
                <p className="loot-sold-line">
                  {loot.amountBasis === "LISTED" ? "Listed at" : "Received"}{" "}
                  <strong>{formatMesos(loot.saleAmount ?? 0, true)}</strong> by {result.seller.name}
                  , {loot.splitMethod === "FAIR" ? "fair" : "lazy"} split. They keep{" "}
                  <strong>{formatMesos(result.seller.keeps, true)}</strong>
                  {result.seller.shares === 1 ? "" : ` on ${result.seller.shares} shares`}.
                </p>
              )}

              <ul className="loot-shares">
                {result.shares.map((share) => (
                  <li key={share.memberId} className={share.paid ? "is-paid" : undefined}>
                    <span className="loot-share-name">{share.name}</span>
                    {/* The raw digits, because this gets pasted into the game's price box. */}
                    <CopyAmount value={share.pay} display={formatMesos(share.pay, true)} />
                    <span className="loot-share-nets">
                      nets {formatMesos(share.nets, true)} at {(share.fee * 100).toFixed(0)}%
                      {sharesLabel(share.shares) && ` \u00b7 ${sharesLabel(share.shares)}`}
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
