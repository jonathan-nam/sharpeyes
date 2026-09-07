"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Field } from "@/components/add-field";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos, shortMesos } from "@/lib/drop-split";
import {
  FATES,
  type Fate,
  type HeldOfYours,
  distributeSale,
  outstandingOf,
  owedByCreditor,
  settledOf,
  queueOf,
  roomFor,
  stillAsking,
} from "@/lib/ledger-fates";
import { transferKey } from "@/lib/piece-ledger";
import { type Holder, type HolderLedger, holderFromKey, holderKey } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import { partyHrefById } from "@/lib/party-path";
import type { VestigeTranche, VestigeTrancheShare } from "@/types/vestige";

// Your own pile: what it still owes, the box that says what became of the coupons, and the nights
// with a debt on them.
//
// Only piles you can sell out of reach this card. What somebody ELSE holds is a debt rather than a
// sale, and it is the Settlement Ledger's, stated in pieces: see lib/settlement.ts.
//
// A person, not a character. One human running three characters has one pile and one box, and each
// boss row names which of their characters looted it, so the fold hides nothing.
//
// Nothing here computes a meso, and there is no longer one to compute. Every figure comes off the
// HolderLedger, which is lib/vestige-ledger.ts's, which is lib/piece-ledger.ts's.

/** What a sale is refused for, mirroring trancheRefusal in VestigeRoutes.kt. */
const MAX_PIECES = 1_000_000;

/**
 * What the picker calls each fate, on somebody else's card and on your own.
 *
 * One control rather than three boxes, because it is one row: they are mutually exclusive fates for
 * the same pieces, and asking all three at once asked four questions when there is only ever one.
 *
 * Two wordings because the card is drawn for a pile you are looking at and for one you are holding,
 * and "they took mine" on your own pile says the opposite of what it would mean.
 */
const LABELS: Record<Fate, { theirs: string; yours: string }> = {
  SOLD: { theirs: "they sold, on the market", yours: "I sold, on the market" },
  KEPT: { theirs: "they kept, their own share", yours: "I kept, my own share" },
  BOUGHT: { theirs: "they took mine, at a price", yours: "I took theirs, at a price" },
};

export function PieceLedger({
  ledgers,
  heldOfYours,
  tranches,
  decided,
  bossByKey,
  partyById,
  iconUrl,
  busy,
  onAddSale,
  onAddKept,
  onAddBought,
  onRemoveSale,
}: {
  ledgers: HolderLedger[];
  /** Pieces of yours the other piles hold, netted into each pile's debt. See HolderCard. */
  heldOfYours: HeldOfYours;
  /** Every holder's tranches, keyed by holderKey(), oldest first as the server returns them. */
  tranches: Map<string, VestigeTranche[]>;
  /** Which sales have had their money decided, and by whom. See decidedSales. */
  decided: Map<string, Set<string>>;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (
    holder: Holder,
    pieces: number,
    amount: number,
    shares: VestigeTrancheShare[],
  ) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (
    holder: Holder,
    pieces: number,
    amount: number,
    shares: VestigeTrancheShare[],
  ) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
}) {
  if (ledgers.length === 0) return null;
  // A settled pile does not reach here: worthDrawing holds it back, because it is finished and
  // finished work is the Settled View's. These bosses drop vestiges on every clear, so a card kept
  // for being settled would be a fixture rather than a task, and it reappears next week anyway the
  // moment the boss is run again.
  return (
    <>
      {ledgers.map((ledger) => (
        <HolderCard
          key={holderKey(ledger.holder)}
          ledger={ledger}
          heldOfYours={heldOfYours}
          tranches={tranches.get(holderKey(ledger.holder)) ?? []}
          decided={decided}
          bossByKey={bossByKey}
          partyById={partyById}
          iconUrl={iconUrl}
          busy={busy}
          onAddSale={onAddSale}
          onAddKept={onAddKept}
          onAddBought={onAddBought}
          onRemoveSale={onRemoveSale}
        />
      ))}
    </>
  );
}

function HolderCard({
  ledger,
  heldOfYours,
  tranches,
  decided,
  bossByKey,
  partyById,
  iconUrl,
  busy,
  onAddSale,
  onAddKept,
  onAddBought,
  onRemoveSale,
}: {
  ledger: HolderLedger;
  /**
   * Pieces of yours each OTHER pile is holding, so this pile's debt reads as what changes hands.
   *
   * Netted per creditor by `owes`: owing Bro 90 while he holds 20 of yours is 70. Passed down rather
   * than derived here, because only the page has every pile to read it off.
   */
  heldOfYours: HeldOfYours;
  tranches: VestigeTranche[];
  decided: Map<string, Set<string>>;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (
    holder: Holder,
    pieces: number,
    amount: number,
    shares: VestigeTrancheShare[],
  ) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (
    holder: Holder,
    pieces: number,
    amount: number,
    shares: VestigeTrancheShare[],
  ) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
}) {
  const [pieces, setPieces] = useState("");
  const [amount, setAmount] = useState("");
  const [fate, setFate] = useState<Fate>("SOLD");
  const [refusal, setRefusal] = useState<string | null>(null);
  const hintId = useId();

  // For naming a share on a tranche already entered, which the debts cannot: those drop the closed
  // drops, and a sale attributed before the boss was settled still says whose it was.
  const creditorNames = new Map(
    ledger.drops.flatMap((d) => d.transfers).map((t) => [t.toId, t.to]),
  );

  // The sales still waiting on a decision. A settled one is off this card for good: see stillAsking
  // for where it goes and how it comes back.
  const shownTranches = stillAsking(tranches, decided);

  const overEntered = Math.max(0, ledger.accounted - ledger.pieces);

  const room = roomFor(ledger, fate);
  const outstanding = outstandingOf(ledger, heldOfYours);
  const owed = owedByCreditor(ledger, heldOfYours);
  // Answered pieces are a figure for the PILE, not per creditor, so once some are answered no
  // per-creditor number can be backed: the names are said and the total stays the pile's own. Naming
  // them with numbers that add up to more than the total would be the plausible wrong number.
  const answered = settledOf(ledger, heldOfYours);
  /**
   * What the count box is waiting for, which is the DEBT and never the pile.
   *
   * It fell back to the room when the debt was answered, and the room is the whole unaccounted pile:
   * settling a 70-piece debt out of 1495 coupons left the box offering 1425. That is the same wrong
   * question `outstanding` was put here to stop asking, arriving one sale later. Nothing outstanding
   * means nothing to suggest, and the gate below means the box is not on screen to suggest it.
   */
  const suggested = Math.min(outstanding, room);

  /** Caps as it is typed, so a number over the room never reaches the button. */
  const clamp = (typed: string, cap: number) => {
    const n = Number(typed.trim());
    return typed.trim() === "" || !Number.isInteger(n) || n <= cap ? typed : String(cap);
  };

  const count = Number(pieces.trim());
  const total = parseMesos(amount);
  /**
   * The row as typed, or null while it cannot be written.
   *
   * A total above zero on the two fates that carry one, matching V47 and V50: a stack that fetched
   * nothing is a redemption, not a sale for nought. Refused here as well as on the server, so the
   * button greys out rather than round-tripping.
   */
  const entry =
    Number.isInteger(count) && count >= 1 && count <= Math.min(MAX_PIECES, room)
      ? fate === "KEPT"
        ? { pieces: count, amount: null }
        : total !== null && total >= 1
          ? { pieces: count, amount: total }
          : null
      : null;

  /**
   * Whose pieces this tranche was, worked out rather than asked for.
   *
   * What you owe goes out first, biggest debt first, capped at each person's netted debt, and the rest
   * is your own: see distributeSale. A box per creditor asked the reader to do that arithmetic and
   * gave no hint what to type, which is how it was reported.
   *
   * Still not a claim about WHICH coupons went to market. It says this much of the money is theirs,
   * which is the thing the debt was always in.
   */
  const attributed = distributeSale(entry?.pieces ?? 0, owed).map(({ creditor, pieces: cut }) => ({
    key: creditor.key,
    holder: holderFromKey(creditor.key),
    name: creditor.name,
    pieces: cut,
  }));
  const attributedPieces = attributed.reduce((sum, s) => sum + s.pieces, 0);
  /** Whether this fate has a price for the boxes below to divide. Only a redemption does not. */
  const priced = fate !== "KEPT";
  /** What to call the tranche being entered, in the two places a message names it. */
  const noun = fate === "BOUGHT" ? "purchase" : "sale";

  // The nights with a debt on them. See queueOf.
  const { owing } = queueOf(ledger, heldOfYours);

  /** Keeps what was typed when the server refuses it, so a rejected sale can be corrected. */
  async function write(action: Promise<void>, clear: "entry" | "paid" | null) {
    setRefusal(null);
    try {
      await action;
      if (clear === "entry") {
        setPieces("");
        setAmount("");
      }
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {/* The coupon is named here rather than on screen: it is the same on every card, so the
            title spends its words on the one thing that differs. */}
        {iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="Vestige of Erion" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          {/* WHOSE pile this is, because that is what picks the card. Every card was titled "Vestige
              of Erion", which is true of all of them and so told them apart not at all: two piles
              read as one card drawn twice, and the page exists to have a sale typed into the right
              one. Coupons are single-trade, so the pile that sold them is the person holding them. */}
          <span className="loot-name">
            {ledger.holder.kind === "SELF" ? "You" : ledger.holderName}
          </span>
          {/* The DEBT, not the pile. See outstandingOf. Nothing where there is none: a card drawn to
              correct a row it already holds has no figure outstanding to state. */}
          {/* NAMED, because a count on its own does not say who is waiting for it: "owes 90 pieces"
              on a pile whose whole debt was one person's left no way to tell which person. Every
              creditor listed, since a pile can owe two, and the number beside each is already net of
              the coupons of yours THEY are holding. */}
          {outstanding > 0 && (
            <span className="loot-meta">
              {answered > 0
                ? `owes ${outstanding} pieces to ${owed.map((c) => c.name).join(", ")}`
                : `owes ${owed.map((c) => `${c.pieces} to ${c.name}`).join(" \u00b7 ")}`}
            </span>
          )}
        </span>
        {/* A finished pile is the Settled View's, which names the act, who with, and what it wrote
            off. This card only reaches the screen again when the reader asks to record a sale into
            it, and by then "fully settled" is the answer to a question nobody asked. */}
        <span className="ledger-tally" />
      </header>

      <div className="ledger-entry">
        {/* Two steps, in the order they happen, each with its own count, its own box and its own rows.
            The pieces and the money were one flat list of chips, so "195 kept" and "4.86b paid" read as
            the same kind of thing when one is what became of the coupons and the other is what came
            back for them. See V50 and V51. */}
        <span className="ledger-step ledger-step-hinted">
          pieces
          {/* Explaining a control, which this app does not do, allowed here because the box opens on
              the debt: nothing says a larger sale is taken until one has been typed, so the split was
              being done by hand. In a bubble rather than under the form, where three lines of it
              crowded the boxes it was about. Only where there IS a debt, since the form also opens on
              a pile owing nobody and "the quantity owed" would name nothing. */}
          {outstanding > 0 && (
            <span className="ledger-hint">
              <button type="button" className="ledger-hint-mark" aria-describedby={hintId}>
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" />
                  <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
                  <path
                    d="M8 7.4v4.2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="visually-hidden">What can go in the pieces box</span>
              </button>
              {/* Drawn whether or not it is on screen, so aria-describedby has something to read and
                  the hint reaches somebody who cannot hover for it. */}
              <span id={hintId} role="tooltip" className="ledger-hint-bubble">
                To assist with calculation, you may optionally enter the whole sale beyond the
                quantity owed. The sale amount for the pieces you owe will be automatically
                calculated.
              </span>
            </span>
          )}
        </span>
        {/* Only the miscount. What is still owed is the header's, and it moves as the debt is
            answered, so "0 of 40 pieces accounted for" under "owes 40 pieces" was the same fact
            twice. More entered than the pile holds is a different fact and still speaks: a card that
            went quiet about it would be hiding what it dropped rather than saying it short. */}
        {overEntered > 0 && (
          <span className="ledger-progress">
            {`all ${ledger.pieces} accounted for, ${overEntered} over`}
          </span>
        )}

        {/* ONE form, because all three are one tranche row: a count, which of the three things happened
            to it, and a price for the two that have one. Three separate boxes asked four questions at
            once and permanently, when at any moment there is only ever this one.

            On screen while the pile owes somebody, and not otherwise: a pile that owes nobody gets
            the same figures whatever it is told (see asksAnything). There is no way to ask for the
            boxes any more, so what a settled pile says is all it says. See worthDrawing.

            Never gated on the COUNT, which is what it looks like from here and is not the same thing.
            That would re-break what alsoHeldByYou exists for: a Sale Ledger that will not admit you
            hold the coupons cannot take the sale. */}
        {outstanding > 0 ? (
          <form
            className="add-fields"
            onSubmit={(e) => {
              e.preventDefault();
              if (!entry) return;
              if (fate === "SOLD")
                void write(
                  onAddSale(
                    ledger.holder,
                    entry.pieces,
                    entry.amount ?? 0,
                    attributed.map((s) => ({ holder: s.holder, pieces: s.pieces })),
                  ),
                  "entry",
                );
              if (fate === "KEPT") void write(onAddKept(ledger.holder, entry.pieces), "entry");
              if (fate === "BOUGHT")
                void write(
                  onAddBought(
                    ledger.holder,
                    entry.pieces,
                    entry.amount ?? 0,
                    attributed.map((s) => ({ holder: s.holder, pieces: s.pieces })),
                  ),
                  "entry",
                );
            }}
          >
            <Field on label="Pieces" cls="is-narrow">
              <input
                className="split-input loot-count-input"
                value={pieces}
                onChange={(e) => setPieces(clamp(e.target.value, room))}
                // The number it is waiting for, so the ordinary case is one keystroke away rather
                // than something to work out from the counts. The debt, where there is one: a box
                // offering 1495 asked about the pile when the question was about 40. Where there is
                // none the box is open because somebody asked for it, and it names itself rather
                // than guessing.
                placeholder={suggested > 0 ? String(suggested) : "pieces"}
                inputMode="numeric"
                aria-label={`Pieces, at most ${room}`}
              />
            </Field>
            {/* These options are not flattened the way the sale boxes' are. "I took theirs" against
                "they took mine" is a DIRECTION, which is the answer itself rather than a connecting
                word a label could carry. */}
            <Field on label="What happened" cls="is-fate">
              <select
                className="split-input"
                value={fate}
                onChange={(e) => setFate(e.target.value as Fate)}
                disabled={busy}
              >
                {/* All three on every card. BOUGHT was hidden on your own, which read as "you cannot
                    buy your own coupons" and meant "the pieces in your pile that are somebody else's
                    can only be sold": a pile you meant to keep never reached all-accounted-for. */}
                {FATES.map((f) => (
                  <option key={f} value={f}>
                    {ledger.holder.kind === "SELF" ? LABELS[f].yours : LABELS[f].theirs}
                  </option>
                ))}
              </select>
            </Field>
            {/* A redemption realized nothing, so it has no price to give. Entered as a sale for zero
                it would price those pieces at nothing and make the creditor absorb half of it. */}
            {fate !== "KEPT" && (
              <Field on label="Sale Amount" cls="is-price">
                <input
                  className="split-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="total"
                  inputMode="decimal"
                />
              </Field>
            )}
            <button type="submit" className="party-save" disabled={busy || entry === null}>
              Add
            </button>
          </form>
        ) : (
          <span className="ledger-progress ledger-none">No vestiges outstanding</span>
        )}
        {/* What the sale pays out, worked out rather than asked for. The one place a coupon debt gets
            a price, and it only can here: these pieces were in YOUR inventory, so the figure being
            divided is one you just typed. What somebody else sold at is still not asked for, and
            still could not be answered. See V56.

            On a purchase as well as a sale, and that is the whole of taking somebody's coupons against
            what they owe you: the price settles the pieces and lands on their card.

            Stated before it is saved, and listed on the row after, because a distribution nobody can
            see is one nobody can correct. */}
        {priced && attributed.length > 0 && (
          <div className="ledger-attribution">
            {attributed.map((share) => {
              // Their slice of THIS tranche, at its own price. Exact within one, which is one lot at
              // one price. The rounding remainder stays on your side.
              const worth =
                entry?.amount && entry.pieces > 0
                  ? Math.round((share.pieces * entry.amount) / entry.pieces)
                  : 0;
              return (
                <span key={share.key} className="loot-share-input">
                  {`${share.pieces} to ${share.name}`}
                  {worth > 0 && <span className="loot-share-nets">{shortMesos(worth)}</span>}
                </span>
              );
            })}
            {/* What is left is yours, said so the two halves of the sale add up on screen. */}
            {entry !== null && entry.pieces > attributedPieces && (
              <span className="loot-share-input">{`${entry.pieces - attributedPieces} yours`}</span>
            )}
          </div>
        )}

        {/* The pieces step's own rows, in the order the queue spends them. Removable because a mistyped
            tranche re-prices every boss behind it.

            Only the sales still waiting on a decision. One whose money has been paid out or offset is
            gone from here, count and all: it is finished, and finished work is not what this card is
            for. See stillAsking. */}
        <span className="ledger-tranches">
          {shownTranches.map((tranche) => (
            <span key={tranche.id} className="ledger-tranche">
              {/* A redemption has no price, so it says what it is rather than dividing by a
                  missing amount. See V46. A purchase has one and is still not a sale, so it says
                  which it is: two rows of "60 @ 25m" that settle differently would be one row
                  repeated. See V50. */}
              {tranche.amount === null
                ? `${tranche.pieces} kept`
                : `${tranche.pieces} @ ${shortMesos(tranche.amount / tranche.pieces)}${
                    tranche.disposition === "BOUGHT" ? " taken" : ""
                  }`}
              {/* Whose pieces it was, where it was not all the seller's. On the row rather than in
                  a total, because this is where a mistyped one is corrected: the ledger's figure for
                  that person moves the moment this row goes. */}
              {(tranche.shares ?? []).map((share) => (
                <span key={holderKey(share.holder)} className="loot-share-nets">
                  {`${share.pieces} ${creditorNames.get(holderKey(share.holder)) ?? "theirs"}`}
                </span>
              ))}
              <button
                type="button"
                className="link ledger-drop-sale"
                disabled={busy}
                onClick={() => void write(onRemoveSale(tranche.id), null)}
                aria-label={
                  tranche.amount === null
                    ? `Remove ${tranche.pieces} kept pieces`
                    : `Remove ${tranche.pieces} pieces for ${formatMesos(tranche.amount, true)}`
                }
              >
                ×
              </button>
            </span>
          ))}
        </span>

        {refusal && <span className="split-error">{refusal}</span>}
      </div>

      <ul className="ledger-queue">
        {/* Only the nights with something outstanding. One that split clean or was answered has
            nothing left to act on, and a closed one is the Settled View's, one row per act with who
            it was closed with and what it wrote off. See queueOf and lib/settled-log.ts. */}
        {owing.map((drop) => {
          const boss = bossByKey.get(drop.bossKey ?? "");
          const party = partyById.get(drop.partyId);
          return (
            <li key={drop.lootId} className="ledger-drop">
              <div className="ledger-drop-head">
                <Link href={partyHrefById(drop.partyId, partyById)} className="loot-name">
                  {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                </Link>
                <span className="loot-meta">
                  {/* Which inventory the pieces are in. The pile is the person's, and this is the
                      one fact that fold would otherwise lose. */}
                  {drop.looterName} · week of {formatWeekStart(drop.weekStart)}
                </span>
                <span className="loot-share-nets">{drop.pieces}</span>
              </div>

              {/* Pieces of this night that are somebody else's, in counts. No price: only the holder
                  can sell a coupon, and what these are worth is whatever the two of you agree. */}
              <ul className="loot-shares">
                {drop.transfers.map((transfer) => (
                  <li key={transferKey(transfer)}>
                    <span className="loot-share-name">owes {transfer.to}</span>
                    <span className="loot-share-nets">{transfer.pieces} pieces</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
