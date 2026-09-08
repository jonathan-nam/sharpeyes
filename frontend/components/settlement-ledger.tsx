"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import {
  type Discharge,
  type HeldOfYours,
  type Settlement,
  type OffsetPart,
  type OffsetShare,
  moneyRows,
  offsetOf,
  owedByYouShares,
  undecidedSales,
  settleThePair,
  shareKey,
} from "@/lib/settlement";
import { apiAssetUrl } from "@/lib/api";
import { CopyAmount } from "@/components/copy-amount";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import { copyText, formatDollars, formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/money";
import { formatDropped } from "@/lib/loot";
import type { Holder } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import { partyHrefById } from "@/lib/party-path";
import type { SettlementDebt, VestigePayment, VestigeTranche } from "@/types/vestige";

// One card per person, in the two units something can stand between you.
//
// MONEY is what THEY owe you, made of every part that has a price: shares of a sale, coupons of
// theirs you sold out of your own pile, what they owe you from elsewhere, and what has been paid. The
// parts are listed because a figure nobody can take apart is a figure nobody can check.
//
// What YOU owe is beside it, not inside it. A share of yours comes off their debt when you press
// Offset and stays off it when you press Mark Sent, and the card cannot know which until you say.
// See Settlement.sharesYouOwe.
//
// PIECES are the other unit and stay a count. Coupons are single-trade, so pieces of yours in
// somebody else's inventory can only be sold by them, and what they fetched is not something this can
// see. The mirror case, where you looted the lot, is priced by the sale you entered: see V56.
//
// Nothing here computes a meso. Every number comes off lib/settlement.ts.

// COLOUR ONLY WHERE "DONE OR NOT" IS A REAL QUESTION, which is the headline and the money that has
// arrived. Red for outstanding, green for paid, green matching .loot-paid.is-paid on a share badge
// so one app cannot have it mean settled on one page and outstanding on the next.
//
// The parts under a card are ARITHMETIC: components that sum to the headline. "Settled" cannot be
// asked of one. Colouring them anyway put a figure like -139,548,023 in red for being unsettled
// while it was also a credit AGAINST the debt above it, so the same number read as a problem and as
// progress at once. The sign carries them instead, and every one of them is signed.

/**
 * One person's receipts, split by whether a closure has already spoken for them.
 *
 * A COUNTED one came off what they owe, so it is an act in the history with the offsets, under the
 * note it was entered with. A SPENT one paid for a pile that was settled afterwards: it counts
 * towards nothing now, and it is drawn only because this is the one screen a mistyped receipt can be
 * taken off. Listing that one with the rest would put money against a debt it has already paid.
 * See paymentsSinceClosing.
 */
export type Receipts = { counted: VestigePayment[]; spent: VestigePayment[] };

const NO_RECEIPTS: Receipts = { counted: [], spent: [] };

/** A count and its noun. Only the regular plural, which is every noun this card counts. */
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function SettlementLedger({
  rows,
  bossByKey,
  partyById,
  offsetShares,
  iconUrl,
  couponName,
  busy,
  payments,
  onRemovePayment,
  onRemoveDebt,
  keptRows,
  onDisposeProceeds,
  onRemoveDisposal,
  onKeepPieces,
  onRemoveKeep,
  onSettlePair,
  onSettleShares,
  onPin,
  onOffsetShares,
}: {
  rows: Settlement[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The shares an offset discharged, resolved, keyed by shareKey(). See V58. */
  offsetShares: Map<string, OffsetShare>;
  /** The coupon's own sprite, for the acts whose every piece is one. See DischargeRow. */
  iconUrl: string | null;
  /**
   * The coupon's own name, off the same drop table its sprite comes from.
   *
   * A sale row said "130 coupons", which is the count and not what was sold. One item behaves this
   * way so the card could have spelled it, and spelling it here is what keeps it the catalog's name
   * rather than a second one. Null falls back to the count alone.
   */
  couponName: string | null;
  busy: boolean;
  /** Each person's receipts, keyed by holderKey(). See Receipts. */
  payments: Map<string, Receipts>;
  onRemovePayment: (paymentId: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  /** Purchases each person's pile has recorded against your coupons. See keptOfYours. */
  keptRows: Map<string, VestigeTranche[]>;
  /**
   * Says what becomes of their money you are holding: off their debt, or sent to them. See V61.
   *
   * The card cannot choose, so it asks. Netting it on arrival was the app deciding something only
   * the two of you can.
   */
  onDisposeProceeds: (holder: Holder, amount: number, kind: "OFFSET" | "PAID") => Promise<void>;
  /** Taking a decision back off, which nothing else on any screen can do. */
  onRemoveDisposal: (disposalId: string) => Promise<void>;
  /**
   * Records that they are keeping the coupons of yours they hold, at a price the two of you agreed.
   *
   * A purchase against THEIR pile naming you, which is V50's act read from the other end. The one
   * offset the netting is not entitled to make on its own.
   */
  onKeepPieces: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  /** Taking one of those back off, which nothing else on any screen can do. */
  onRemoveKeep: (trancheId: string) => Promise<void>;
  /** Closes the coupon books with this person, BOTH sides at once. See settleThePair. */
  onSettlePair: (holder: Holder, theirs: string[], yours: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
  /** Keeps this person's card drawn with nothing outstanding, or stops. See V59. */
  onPin: (row: Settlement, pinned: boolean) => Promise<void>;
  /** Marks the shares paid AND records the offset, which takes it off what they owe. See V57. */
  onOffsetShares: (holder: Holder, name: string, parts: OffsetPart[]) => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="loot-pool-title settlement-ledger-title">Outstanding Settlements</h3>
      {rows.map((row) => (
        <SettlementCard
          key={row.key}
          row={row}
          bossByKey={bossByKey}
          partyById={partyById}
          offsetShares={offsetShares}
          iconUrl={iconUrl}
          couponName={couponName}
          busy={busy}
          payments={payments.get(row.key) ?? NO_RECEIPTS}
          onRemovePayment={onRemovePayment}
          onRemoveDebt={onRemoveDebt}
          keptRows={keptRows.get(row.key) ?? []}
          onDisposeProceeds={onDisposeProceeds}
          onRemoveDisposal={onRemoveDisposal}
          onKeepPieces={onKeepPieces}
          onRemoveKeep={onRemoveKeep}
          onSettlePair={onSettlePair}
          onSettleShares={onSettleShares}
          onPin={onPin}
          onOffsetShares={onOffsetShares}
        />
      ))}
    </>
  );
}

function SettlementCard({
  row,
  bossByKey,
  partyById,
  offsetShares,
  iconUrl,
  couponName,
  busy,
  payments,
  onRemovePayment,
  onRemoveDebt,
  keptRows,
  onDisposeProceeds,
  onRemoveDisposal,
  onKeepPieces,
  onRemoveKeep,
  onSettlePair,
  onSettleShares,
  onPin,
  onOffsetShares,
}: {
  row: Settlement;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The shares an offset discharged, resolved, keyed by shareKey(). See V58. */
  offsetShares: Map<string, OffsetShare>;
  /** The coupon's own sprite, for the acts whose every piece is one. See DischargeRow. */
  iconUrl: string | null;
  /** The coupon's own name, so a sale row says what was sold and not only how much of it. */
  couponName: string | null;
  busy: boolean;
  /** This person's receipts. See Receipts. */
  payments: Receipts;
  onRemovePayment: (paymentId: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  /** This person's pile's purchases of your coupons, so a mistyped one can be taken back. */
  keptRows: VestigeTranche[];
  /**
   * Says what becomes of their money you are holding: off their debt, or sent to them. See V61.
   *
   * The card cannot choose, so it asks. Netting it on arrival was the app deciding something only
   * the two of you can.
   */
  onDisposeProceeds: (holder: Holder, amount: number, kind: "OFFSET" | "PAID") => Promise<void>;
  /** Taking a decision back off, which nothing else on any screen can do. */
  onRemoveDisposal: (disposalId: string) => Promise<void>;
  /**
   * Records that they are keeping the coupons of yours they hold, at a price the two of you agreed.
   *
   * A purchase against THEIR pile naming you, which is V50's act read from the other end. The one
   * offset the netting is not entitled to make on its own.
   */
  onKeepPieces: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  /** Taking one of those back off, which nothing else on any screen can do. */
  onRemoveKeep: (trancheId: string) => Promise<void>;
  /** Closes the coupon books with this person, BOTH sides at once. See settleThePair. */
  onSettlePair: (holder: Holder, theirs: string[], yours: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
  /** Keeps this person's card drawn with nothing outstanding, or stops. See V59. */
  onPin: (row: Settlement, pinned: boolean) => Promise<void>;
  /** Marks the shares paid AND records the offset, which takes it off what they owe. See V57. */
  onOffsetShares: (holder: Holder, name: string, parts: OffsetPart[]) => Promise<void>;
}) {
  const [kept, setKept] = useState("");
  // Whether the history of what has come off is open. Folded by default: it is the half that grows.
  const [showOff, setShowOff] = useState(false);
  // Whether what the debt is made of is open. FOLDED, like the two beside it: the figure it comes to
  // is on the heading's line either way, so what opening it adds is which rows made that figure, and
  // it opened with its arrow pointing at a closed panel besides.
  const [showOwed, setShowOwed] = useState(false);
  // Whether the sales behind the money you are holding are open. Folded, like the offsets history:
  // the figure is what you act on and the rows are the check on it.
  const [showHeld, setShowHeld] = useState(false);
  // Closed to start, the way the held sales above are. The step says the count, which is the fact
  // this section is read for; WHICH nights it came off is the follow-up question.
  const [showNights, setShowNights] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // What they are paying to keep the coupons of yours they hold. Above zero, matching the server: a
  // stack handed over for nothing is not a purchase at a price of nought, it is a handover.
  const keeping = parseMesos(kept);
  const keeps = keeping !== null && keeping >= 1 ? keeping : null;

  /**
   * A part's label, led by the pieces it answered for where it answered for any.
   *
   * The count is what the headline above stopped asking for, so it belongs on the row that took it
   * away. Absent on the rows that carry no count: a leading zero would read as a debt of nothing.
   */
  const countedLabel = (pieces: number, label: string) =>
    pieces > 0 ? `${pieces} ${label}` : label;

  async function write(action: Promise<void>, clear: null | (() => void)) {
    setRefusal(null);
    try {
      await action;
      clear?.();
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  // Each half only when there is one. The mesos are netted, so it is one figure in one direction
  // rather than a column of both.
  //
  // To the MESO, not shortened. A settled 144m share moved this card from 253.86b to 254b, which at
  // two decimals is a figure that did not appear to move at all: the parts below have always been
  // exact, so rounding only their sum made the one number you act on the one number you cannot
  // check. This is a debt somebody is going to be asked for, and the pieces beside it are a count.
  // The one figure on the card anybody pastes anywhere, whichever way it runs. Null when the two
  // sides cancel and only the pieces hold the card here.
  // What YOU owe them, however it got there: a net that came out against you and shares nobody has
  // decided about are the same errand. Never subtracted from `mesos`, which is what they owe you and
  // moves when Offset is pressed rather than before. See sharesYouOwe.
  const youOwe = row.owedByYou + row.sharesYouOwe;
  const toCopy = row.mesos > 0 ? row.mesos : youOwe > 0 ? youOwe : null;
  // Whether the headline says anything. Since the coupons left it, a card can be held here by its
  // pieces alone, and this line would then be an empty one. See #629.
  const headline = toCopy !== null || row.usd.owed > 0 || row.usd.owe > 0;

  /**
   * The drops behind the shares figure, on hover.
   *
   * They are already listed further down the card, under their own step, but two forms sit between
   * the two: the number and the nights it came off do not read as the same thing from that far
   * apart. Only the ones this figure is made of, which is the direction running towards you: what
   * you owe is outside the net and is listed under the step below with the acts that answer it.
   */
  const behindShares = row.lines
    // Meso lines only. This is the breakdown of `parts.shares`, which is the meso figure, and a
    // dollar share listed under it would be an item that total is not made of. The dollars are on
    // the headline in their own unit and in the shares list below, each in its own.
    .filter((line) => line.direction === "owed" && line.currency === "MESO")
    .map((line) => {
      const boss = bossByKey.get(line.bossKey ?? "");
      const party = partyById.get(line.partyId);
      const where = boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss";
      return `${line.name} \u00b7 ${where} \u00b7 ${line.theirs}: ${formatMoney(line.pay, line.currency, true)}`;
    })
    .join("\n");

  /**
   * A component of the net, always signed: nothing else on the row says which way it pushes.
   *
   * Mesos unless told otherwise, which is every caller but the shares list: a debt entered by hand,
   * a payment and an offset are all meso rows, and only a share can be in dollars.
   */
  const signed = (value: number, currency: Currency = "MESO") =>
    `${value > 0 ? "+" : ""}${formatMoney(value, currency, true)}`;

  // What the net is made of, in the order the money moved, before the rows somebody typed. Only the
  // parts that happened: a zero says nothing and a column of them would bury the one that matters.
  const parts = [
    {
      key: "shares",
      label: "shares",
      mesos: row.parts.shares,
      detail: behindShares,
    },
    // `soldOfTheirs` is NOT here, and must not be. It is only ever the part of their money somebody
    // has said comes off their debt, which makes it a discharge, and discharges are listed once
    // under `offsets`. It was in both lists at once: 2,412,222,150 read as a row of the owed
    // list and again inside the fold below it, so the two lists came to more than the card did.
    {
      key: "theirs",
      label: countedLabel(row.piecesAnswered.yours, `coupons of mine ${row.name} sold`),
      mesos: row.parts.soldOfYours,
    },
  ].filter((part) => part.mesos !== 0);

  /**
   * Discharging what you owe against what they owe you, and what that leaves. See offsetOf.
   *
   * The settlement two people actually make when the sums are lopsided: rather than send somebody
   * 139,548,023 and have them send 254b back, it comes off the larger figure. Marking the share paid
   * alone said the money had moved, which took it out of the netting and put what they owe you back
   * UP, and that is the opposite of what happened. See V57.
   */
  // What builds the debt, and what has already come off it. Two questions, so two lists: see
  // moneyRows for why one list could not hold both.
  const { typed, discharges, discharged } = moneyRows(row, payments.counted);
  // How many rows the `owed` list holds, which is what decides whether it folds at all and what the
  // folded line says is inside it.
  const owedParts = parts.length + typed.length;
  const openOwed = showOwed || owedParts === 0;
  /**
   * What the rows under `owed` come to, which is the debt BEFORE anything came off it.
   *
   * The sum of its own rows and nothing else, the way the offsets figure is the sum of its own. So
   * the card's arithmetic is on the card: this figure less the offsets one is the header's, which is
   * `priced` in buildSettlement and `row.mesos - row.owedByYou` out here. Pinned in
   * settlement.test.ts, since two spellings of one figure is how they come to disagree.
   */
  const owedTotal =
    parts.reduce((sum, part) => sum + part.mesos, 0) +
    typed.reduce((sum, entry) => sum + entry.amount, 0);
  // Whether the left half holds anything at all. The two entry forms left the card, so with nothing
  // priced and no spent receipt it is an empty box, and an empty box in the pair is still 12px of
  // padding and a rule under it: the card read as a gap between its header and the next section.
  const anyOwed = owedParts > 0 || payments.spent.length > 0;
  // An OFFSET here is anything that came off the debt, which is the account's word for the step and
  // covers a payment: it is a count of acts, and each row inside names which act it was.
  const offsets = plural(discharges.length, "offset");
  // Money you SENT them, which took nothing off what they owe you and so is not in `discharges`.
  const paidOut = row.disposals.filter((d) => d.kind === "PAID");

  // The nights one handover finishes, both sides. Offered whenever either side has one: a debt that
  // runs only one way is still a pair, with nothing on the other end.
  const pair = settleThePair(row);

  const offset = offsetOf(row);
  // Mesos a settle would declare you have ALREADY sent. Off the offset, rather than summed again
  // here: two spellings of one figure is how the button and its label come to disagree.
  const owes = offset.amount;
  // The aggregate Settle that used to live here is GONE, and its history is worth keeping.
  //
  // It marked every share on the card paid in BOTH directions, on the reasoning that a relationship
  // is settled by one transfer of the difference. That holds while a card is in one unit. It stops
  // holding the moment one is not: there is no rate to net $333.33 against 2.32b, so collecting
  // what they owe and recording what you owe as sent are two acts on two days, and one button doing
  // both records a transfer that never happened. It was already the card's sharpest edge before
  // that (it was pulled off cards with nothing to collect for the same family of reason), and the
  // shares list carries a per-line act now, which is the same write with the direction it belongs
  // to. See the button in the shares list.
  /**
   * The two pots a closing act moves, and they stay two pots everywhere else on this card.
   *
   * SHARES you owe are your cut of a night of theirs. HOLDING is their own money, which a sale of
   * their coupons left in your hands. What can happen to each is the same pair of things, so one
   * button covers both: one trade settles both, and two buttons wearing one word ("Offset" twice,
   * "Mark Sent" beside "I paid them") said nothing about which pot each was for.
   *
   * Each pot is still WRITTEN on its own, so a click is two calls where both apply. If the second is
   * refused the first stands, which the refusal line says; both are reversible where they are drawn,
   * a disposal on this card and a share on the party page.
   */
  const offsettable = offset.offered || row.holding > 0;
  /**
   * Whether there is anything of theirs to send.
   *
   * Distinct from Settle, which collects, and from Offset, which discharges against a debt of
   * theirs. This is the third thing that can happen: the mesos left your hands.
   *
   * It went missing when Settle was pulled off a card with nothing to collect, and pulling it was
   * right; what was wrong was leaving no act in its place. Jared's card said "you owe 289,382,716"
   * with nothing to do about it, which is a ledger you cannot keep.
   *
   * Dollars are in it for the same reason. `owes` is the meso figure alone (an offset cannot be
   * made in dollars, see offsetOf), so without this a share of a real money sale that YOU owe drew
   * the same dead card the note above is about.
   */
  const sendable = owes > 0 || row.usd.owe > 0 || row.holding > 0;

  /**
   * What an act moves, pot by pot.
   *
   * Never one sum of the two: this card keeps them apart everywhere, and the act writes them apart.
   * With one pot in play it reads as the single figure it always did.
   */
  const moved = (shares: number) =>
    shares > 0 && row.holding > 0
      ? `${formatMesos(shares, true)} of shares and ${formatMesos(row.holding, true)} you are holding`
      : formatMesos(shares > 0 ? shares : row.holding, true);

  /**
   * The same, with the dollar half beside it, for the acts that move both.
   *
   * Never one sum, there being no rate to add them at, and never the mesos alone: a caption that
   * names one unit describes half of what its button does. Settle collected $333.33 while saying
   * only that it recorded 2.32b sent, which is a button doing something it did not mention.
   */
  const movedBoth = (shares: number, cents: number) =>
    [shares > 0 || row.holding > 0 ? moved(shares) : null, cents > 0 ? formatDollars(cents) : null]
      .filter(Boolean)
      .join(" and ");

  // The sales the held money is still sitting on, where they can be told exactly. See undecidedSales.
  const held = undecidedSales(row);

  // The nights each side will actually DRAW. A night a sale answered for, or one the other side
  // cancelled, sits in the array at zero: settleThePair still closes it, so it is kept, and
  // PieceNights draws it in neither list. A length is not the same question as whether there is a
  // list, and asking the wrong one put "Bro is holding" over nothing at all.
  const theirNights = row.drops.filter((drop) => drop.pieces > 0);
  const myNights = row.owedDrops.filter((drop) => drop.pieces > 0);

  /**
   * Whether there is a coupon debt to draw, which the section's gate and its step both ask.
   *
   * Zero net is not drawn: the coupon relationship is a running balance and a balance at zero is
   * nothing to close. See the step for the rest.
   */
  const couponsOpen = row.piecesNet !== 0 && (theirNights.length > 0 || myNights.length > 0);

  /** Everything of theirs that can come off their debt. */
  const offsetAll = async () => {
    if (offset.offered) await onOffsetShares(row.holder, row.name, offset.parts);
    if (row.holding > 0) await onDisposeProceeds(row.holder, row.holding, "OFFSET");
  };
  /** Everything of theirs that has left your hands. */
  const sendAll = async () => {
    if (owes > 0) await onSettleShares(owedByYouShares(row));
    if (row.holding > 0) await onDisposeProceeds(row.holder, row.holding, "PAID");
  };

  /**
   * The nights one act discharged, named. Off the pools rather than the wallet's lines: the settle
   * that made an offset marked those shares PAID, so they have left the wallet by the time this row
   * is drawn. That is the whole reason V58 stores them.
   */
  const nightsBehind = (payouts: { lootId: string; memberId: string }[]): OffsetShare[] =>
    payouts.map(
      (share) =>
        offsetShares.get(shareKey(share.lootId, share.memberId)) ?? {
          // The drop has been deleted since. Said rather than left out: a row that quietly drops one
          // of the nights behind a figure is a figure that no longer adds up.
          key: shareKey(share.lootId, share.memberId),
          // Empty rather than the id it was keyed by: there is nothing at the other end of a link
          // to a drop that is gone, so the row names it and goes nowhere. It is also what stops a
          // deleted night being split back out into a row. See splittableOffset.
          lootId: "",
          memberId: share.memberId,
          item: "A drop that has been deleted",
          iconUrl: null,
          boss: "",
          members: [],
          on: "",
          share: 0,
          // Mesos, being the unit of a zero on a deleted drop: an offset is a meso act, so a share
          // it discharged was one. See offsetOf.
          sale: null,
          currency: "MESO",
          partyId: "",
        },
    );

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {/* Kept whatever it says. Only a PERSON can be pinned: a character nobody has claimed is
            somebody the account cannot name yet, and pinning one would keep a card for a human it
            may turn out to already have. */}
        {row.attributed && (
          <button
            type="button"
            className={row.pinned ? "ledger-pin is-pinned" : "ledger-pin"}
            disabled={busy}
            onClick={() => void write(onPin(row, !row.pinned), null)}
            aria-label={row.pinned ? `Stop keeping ${row.name}'s card` : `Keep ${row.name}'s card`}
            title={row.pinned ? "Kept. Click to stop." : "Keep this card when nothing is owed"}
          >
            {row.pinned ? "★" : "☆"}
          </button>
        )}
        <span className="loot-title">
          <span className="loot-name">{row.name}</span>
          {/* The direction the whole card runs, coloured as the parts below it are, so the headline
              and its own arithmetic never read as two different kinds of thing.

              The money is copyable: it is the figure that gets pasted into the game's trade box, and
              retiring the Wallet took the only place on this account where that was possible.

              MONEY ONLY. The netted coupon count used to sit here too, which made one line carry two
              units with nothing saying they could not be added. It says the same words one section
              down, on the step that names the coupon it is a count OF.

              Drawn only when it has something in it. A card can now be held here by its coupons
              alone, and this is the line that would have been an empty one: see #629. */}
          {headline && (
            <span className={"loot-meta ledger-summary is-open"}>
              {toCopy !== null && (
                <CopyAmount
                  value={toCopy}
                  display={
                    row.mesos > 0
                      ? `${formatMesos(row.mesos, true)} owed`
                      : `you owe ${formatMesos(youOwe, true)}`
                  }
                />
              )}
              {/* Both directions, said rather than netted. The headline is what they owe you and it
                stays that until an act moves it, so a card running both ways has to carry the other
                side out loud or it would say nothing about money you have to send. */}
              {row.mesos > 0 && youOwe > 0 && <span>{`you owe ${formatMesos(youOwe, true)}`}</span>}
              {/* A THIRD UNIT, said the way the coupons above are: on its own, in both directions,
                and never netted against the mesos. There is no rate in this app, so $333.34 and
                600b cannot become one figure, and the one that looked like they had would be the
                confident wrong number. Copyable for the same reason the mesos are: it is what gets
                pasted into whatever moves the money. See lib/money.ts. */}
              {row.usd.owed > 0 && (
                <CopyAmount
                  value={row.usd.owed}
                  display={`${formatDollars(row.usd.owed)} owed`}
                  copy={copyText(row.usd.owed, "USD")}
                />
              )}
              {row.usd.owe > 0 && <span>{`you owe ${formatDollars(row.usd.owe)}`}</span>}
            </span>
          )}
        </span>
        {/* Money they sent beyond anything priced, which is a payment for the pieces. Out here rather
            than in the net below: a piece debt has no price for it to count down, and netting it
            would say you owed them the moment they paid you for coupons you cannot value. */}
        {row.receivedOnPieces > 0 && (
          <span className="ledger-tally">
            <span className="ledger-amount is-paid">
              {formatMesos(row.receivedOnPieces, true)} received
            </span>
          </span>
        )}
      </header>

      {/* What builds the debt beside what has come off it, half a card each.

          Two questions about one figure, so they are read against each other rather than one
          scrolled past to reach the other. `shares` follows below, being the detail behind a
          single row of the left half rather than a third question. The right half is absent on
          most cards, and the grid gives its width back when it is: the forms on the left take a
          price and a note, which is more than half a card's worth of boxes. */}
      {(anyOwed || discharges.length > 0) && (
        <div className="ledger-pair">
          {/* The money, and what it is made of. Every entered row is removable and nothing else is: the
          others are corrected where they were recorded, which is the sale or the split itself. */}
          {anyOwed && (
            <div className="ledger-entry">
              {/* Nothing priced yet means no step at all, not the word OWED over a gap. Where there
                  is a list it folds, and where there is not there is no chevron either, which is
                  the card's rule everywhere else.

                  ONE SHAPE, here and under Offsets and Unsettled Amounts: the heading, its
                  chevron, then the figure the fold sums to. The three grew up separately and read as
                  three kinds of thing, one carrying its total beside the heading and one on a row of
                  its own inside the list. */}
              {owedParts > 0 && (
                <div className="ledger-step-line">
                  <span className="ledger-heading">Owed</span>
                  <button
                    type="button"
                    className="party-row-toggle"
                    aria-expanded={showOwed}
                    aria-controls={`owed-${row.key}`}
                    onClick={() => setShowOwed((o) => !o)}
                  >
                    <span className="party-row-chevron" aria-hidden="true" />
                    <span className="visually-hidden">
                      {showOwed
                        ? `Hide what ${row.name} owes you`
                        : `Show what ${row.name} owes you`}
                    </span>
                  </button>
                  <span className="ledger-amount">{signed(owedTotal)}</span>
                </div>
              )}
              <div className="ledger-fold" id={`owed-${row.key}`} hidden={!openOwed}>
                {(parts.length > 0 || typed.length > 0) && (
                  <ul className="ledger-queue">
                    {parts.map((part) => (
                      <li key={part.key} className="ledger-drop">
                        {/* The nights behind the figure, where there are any. A title, because this is the
                    detail of one row rather than something the card owes everybody: the same list
                    is under its own step below, and both are the wallet's, not a third answer. */}
                        <div className="ledger-drop-head" title={part.detail || undefined}>
                          <span className={part.detail ? "loot-name has-detail" : "loot-name"}>
                            {part.label}
                          </span>
                          <span className="ledger-amount">{signed(part.mesos)}</span>
                        </div>
                      </li>
                    ))}
                    {typed.map((entry) => (
                      <EnteredRow
                        key={entry.id}
                        entry={entry}
                        name={row.name}
                        busy={busy}
                        signed={signed}
                        onRemove={() => void write(onRemoveDebt(entry.id), null)}
                      />
                    ))}
                  </ul>
                )}

                {/* Receipts a closure has already spoken for, which are in none of the arithmetic above.
            Kept because this is the only place a payment can be taken back: it used to be done on
            the Sale Ledger, on a card that held the old per-holder tranches, and that card is gone.
            Empty until a pile is settled, which is the usual state of a card. */}
                {payments.spent.length > 0 && (
                  <span className="ledger-tranches">
                    {payments.spent.map((got) => (
                      <span key={got.id} className="ledger-tranche">
                        {got.note
                          ? `${formatMesos(got.amount, true)} paid \u00b7 ${got.note}`
                          : `${formatMesos(got.amount, true)} paid`}
                        <ArmedRemove
                          busy={busy}
                          label={`Remove the ${formatMesos(got.amount, true)} payment`}
                          onRemove={() => void write(onRemovePayment(got.id), null)}
                        />
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* What has already come off, folded to one line.

          Its own step because it is a different question from the one beside it: `owed` is a
          standing fact, this is a history of acts. Mixed into one list an offset read as a debt,
          told apart only by a chevron, and every press of Offset added a line that never left.

          A PAYMENT is one of these acts: mesos they sent came off what they owe exactly as an offset
          does, dated and removable the same way. It is an offset in the sense the step means, which
          is what came off, and the row inside says which act it was.

          FOLDED, because this is the half that grows without bound. Three acts against one person
          were three near-identical rows burying the one that said what he owed. The count and the
          total are on the line, so nothing is hidden by folding it: what is inside is which act and
          when, and that is what a reader opens it for. */}
          {discharges.length > 0 && (
            <div className="ledger-entry">
              {/* The heading, its chevron, then the figure. It used to be a ROW inside the list, a
                  count and a total and the chevron on one line, which is why this half read as a
                  different kind of thing from the half beside it. The count is in the chevron's own
                  label, which is where a screen reader needs it and the only place it was doing
                  work: how many acts is what opening it says. */}
              <div className="ledger-step-line">
                <span className="ledger-heading">Offsets</span>
                <button
                  type="button"
                  className="party-row-toggle"
                  aria-expanded={showOff}
                  aria-controls={`off-${row.key}`}
                  onClick={() => setShowOff((o) => !o)}
                >
                  <span className="party-row-chevron" aria-hidden="true" />
                  <span className="visually-hidden">
                    {showOff ? `Hide the ${offsets}` : `Show the ${offsets}`}
                  </span>
                </button>
                <span className="ledger-amount">{signed(-discharged)}</span>
              </div>

              {/* A queue, not a share list. `.loot-shares > li` is a wrapping ROW with a rule above
                  it, and a `.ledger-drop` is a COLUMN with a rule down its left: nesting one in the
                  other gave every act both, so the rows came out with a stray top border and two
                  indents fighting. Drop rows go in a drop queue. */}
              {showOff && (
                <ul className="ledger-queue" id={`off-${row.key}`}>
                  {discharges.map((act) => (
                    <DischargeRow
                      key={act.id}
                      act={act}
                      name={row.name}
                      shares={nightsBehind(act.payouts)}
                      iconUrl={iconUrl}
                      busy={busy}
                      signed={signed}
                      onRemove={() =>
                        void write(
                          act.source === "DEBT"
                            ? onRemoveDebt(act.id)
                            : act.source === "PAYMENT"
                              ? onRemovePayment(act.id)
                              : onRemoveDisposal(act.id),
                          null,
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Everything outstanding, itemised, in the two shapes it is outstanding in: shares of a
          night, and their own money a sale of their coupons left in your hands. One section, because
          one transfer of the difference closes both and Closing Actions acts on both at once. Two
          steps inside it, because a share is a claim on somebody and the money is already here.

          The card is one person's, so the heading does not name them again. It used to, and the two
          halves were two sections with nothing between them but a rule. */}
      {(row.lines.length > 0 || row.holding > 0 || paidOut.length > 0 || couponsOpen) && (
        <div className="ledger-entry">
          {/* The heading, its chevron, then the figure, which is the shape Owed and Offsets wear
              too. Copyable, like the card's own headline, because sending it means pasting it into a
              trade box.

              The figure is the money of THEIRS you are holding, and it sums the sales in the fold
              directly under it. It is not a total of the whole section: the shares below run both
              ways and are in the card's header already, and adding a count of coupons to a pile of
              mesos is the one sum this account never makes. The `shares` step is what tells them
              apart, and it is why that step keeps its label while nothing else in here has one. */}
          <div className="ledger-step-line">
            <span className="ledger-heading">Unsettled Amounts</span>
            {row.holding > 0 && held.length > 0 && (
              <button
                type="button"
                className="party-row-toggle"
                aria-expanded={showHeld}
                aria-controls={`held-${row.key}`}
                onClick={() => setShowHeld((o) => !o)}
              >
                <span className="party-row-chevron" aria-hidden="true" />
                <span className="visually-hidden">
                  {`${showHeld ? "Hide" : "Show"} the ${plural(held.length, "sale")} behind it`}
                </span>
              </button>
            )}
            {row.holding > 0 && (
              <span className="ledger-amount">
                <CopyAmount value={row.holding} display={formatMesos(row.holding, true)} />
              </span>
            )}
          </div>

          {/* Their money, in your hands, with nothing decided about it yet.

              Two things can happen to it and they end in different places, so the card asks rather
              than choosing: OFFSET takes it off what they owe you, sending it leaves their debt where
              it was. Until one is recorded it is outside the net entirely, which is why this is not
              a part under `owed`. See V61.

              The sales it is made of, folded, one to a row. It arrived as a bare 2.41b with nothing
              anywhere saying that was 130 coupons over two nights. They add up to the figure above
              exactly, or there are none of them at all: undecidedSales refuses a list it cannot land
              on a sale boundary rather than name coupons whose money has partly gone.

              Keyed by position, a tranche's id having nothing to say here that its coupons and its
              day do not. */}
          {showHeld && held.length > 0 && (
            <ul className="loot-shares" id={`held-${row.key}`}>
              {held.map((sale, i) => (
                <li key={`held-${i}`}>
                  {iconUrl ? (
                    <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="" />
                  ) : (
                    <span className="loot-icon" aria-hidden="true" />
                  )}
                  <span className="loot-share-name">
                    {couponName ? `${sale.pieces} ${couponName}` : `${sale.pieces} coupons`}
                  </span>
                  <span className="loot-share-nets">
                    {[
                      sale.soldAt && dayOf(sale.soldAt),
                      // Only where the lot was not all theirs. Their share of a mixed one is a
                      // figure nobody can check without the lot it came out of.
                      sale.pieces !== sale.lot.pieces &&
                        `of ${sale.lot.pieces} for ${formatMesos(sale.lot.amount, true)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="ledger-amount">{formatMesos(sale.mesos, true)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Both directions, each line signed, so a list holding both ways round says which is
              which without a word. `pay`, not `nets`: every other figure on this card is pre-fee, so
              a line drawn net of it disagreed with the Offset below by the 5%, listing a 703,703,488
              offset as a 668,518,313 share. See settlement-figure for the whole card's unit. */}
          {row.lines.length > 0 && (
            <>
              <span className="ledger-step">shares</span>
              <ul className="ledger-queue">
                {row.lines.map((line) => {
                  const boss = bossByKey.get(line.bossKey ?? "");
                  const party = partyById.get(line.partyId);
                  return (
                    <li key={`${line.lootId}:${line.theirsId}`} className="ledger-drop">
                      <div className="ledger-drop-head">
                        {/* The art the rest of the account reads drops by. A list of drops that
                            drops the icons is the one place you cannot tell two grindstones apart
                            at a glance. */}
                        {line.iconUrl ? (
                          <img className="loot-icon" src={apiAssetUrl(line.iconUrl)} alt="" />
                        ) : (
                          <span className="loot-icon" aria-hidden="true" />
                        )}
                        <Link href={partyHrefById(line.partyId, partyById)} className="loot-name">
                          {line.name}
                        </Link>
                        <span className="loot-meta">
                          {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}{" "}
                          · {line.theirs}
                        </span>
                        <span className="ledger-amount">
                          {signed(line.direction === "owe" ? -line.pay : line.pay, line.currency)}
                        </span>
                        {/* The act, on the line it is about.

                            One transfer of the difference is what the aggregate Settle assumed, and
                            it cannot hold across units: no rate exists to net $333.33 against 2.32b,
                            so collecting one and recording the other as sent are two things that
                            happen on two days. Named for its own direction, because the same write
                            means "I received it" on one line and "I sent it" on the next. */}
                        <button
                          type="button"
                          className="party-save ledger-line-act"
                          disabled={busy}
                          onClick={() =>
                            void write(
                              onSettleShares([{ lootId: line.lootId, memberId: line.payeeId }]),
                              null,
                            )
                          }
                          aria-label={`Mark the ${line.name} share ${
                            line.direction === "owed" ? "received from" : "sent to"
                          } ${line.theirs}`}
                        >
                          {line.direction === "owed" ? "Mark Received" : "Mark Sent"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* Only what was SENT to them. A decision to offset took something off what they owe you,
              so it is said under `offsets` with everything else that did: one place for one kind of
              fact. Paying them out took nothing off, which is exactly why it stays here, beside the
              money it came out of.

              Removable, and only here: nothing else on any screen records one. */}
          {paidOut.length > 0 && (
            <span className="ledger-tranches">
              {paidOut.map((disposal) => (
                <span key={disposal.id} className="ledger-tranche">
                  {`${formatMesos(disposal.amount, true)} paid out`}
                  <button
                    type="button"
                    className="link ledger-drop-sale"
                    disabled={busy}
                    onClick={() => void write(onRemoveDisposal(disposal.id), null)}
                    aria-label={`Undo ${formatMesos(disposal.amount, true)} paid out to ${row.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </span>
          )}
          {/* The nights the coupons are still sitting on, both directions, and the act that closes
              them. No price on either side: what a coupon fetched is only known where somebody sold
              it and said so, and that is already money in this same section.

              IN Unsettled Amounts, under a step naming the coupon, which is where a reader looks
              for what is outstanding. It was a section of its own headed only by whose inventory,
              so the one screen that lists what stands between two people said "Extreme Kalos the
              Guardian, 390" and never once said what 390 of.

              The netted count rides the step, in the words the header used to carry: one handover
              settles the pair, holding 90 of theirs while they hold 20 of yours is 70 changing
              hands, and which way it runs is in the words because "pieces" alone said nothing
              about direction.

              Each list is one side of that count and already subtracted from it, so under a bare
              "PIECES" they read as a claim on top: a card netting to 130 listed a 20 under it, and
              20 was not 20 more. The two sides cancel before either is drawn, so together they come
              to exactly the step.

              Drawn whenever there is a night, even where none of them can be closed. The button is
              what the refusal takes away, never the list: a card that went quiet about what is
              outstanding would be hiding exactly what it is for.

              NOT drawn when the two sides cancel. Nothing is outstanding in coupons, so there is
              nothing to hand over and nothing to read: the coupon relationship is a running
              balance, and a balance at zero is not a thing anybody has to close. It comes straight
              back the moment a night tips it either way, with every night still on it. */}
          {couponsOpen && (
            <>
              <div className="ledger-step-line">
                <span className="ledger-step">{couponName ?? "Coupons"}</span>
                {/* The same fold the held sales wear, on the row that carries the count. A pile of
                    nights is a long list to leave open under a figure that already says what they
                    come to. */}
                <button
                  type="button"
                  className="party-row-toggle"
                  aria-expanded={showNights}
                  aria-controls={`nights-${row.key}`}
                  onClick={() => setShowNights((open) => !open)}
                >
                  <span className="party-row-chevron" aria-hidden="true" />
                  <span className="visually-hidden">
                    {`${showNights ? "Hide" : "Show"} the ${plural(
                      theirNights.length + myNights.length,
                      "night",
                    )} behind it`}
                  </span>
                </button>
                <span className="ledger-amount">
                  {row.piecesNet > 0 ? `${row.piecesNet} to hand over` : `${-row.piecesNet} owed`}
                </span>
              </div>
              {showNights && (
                <div id={`nights-${row.key}`}>
                  {theirNights.length > 0 && (
                    <>
                      <span className="ledger-step">{`${row.name} is holding`}</span>
                      <PieceNights
                        drops={theirNights}
                        bossByKey={bossByKey}
                        partyById={partyById}
                      />
                    </>
                  )}
                  {myNights.length > 0 && (
                    <>
                      <span className="ledger-step">I am holding</span>
                      <PieceNights drops={myNights} bossByKey={bossByKey} partyById={partyById} />
                    </>
                  )}

                  {/* Only the nights the closing act will NOT close. The ones it will are the rows
                      directly above, so counting them back read as a second fact and matched
                      nothing else on the card: 22 was eleven rows in each pile, and no screen in
                      this app has 22 of anything else.

                      A night owing a third person cannot be closed for one of them, so it stays
                      open and is said. Silence there would be the count quietly going short. It
                      folds WITH the lists it is about, being a statement about which of them the
                      button will reach. */}
                  {pair.shared > 0 && (
                    <span className="ledger-progress">
                      {`${pair.shared} shared with others, not closed here`}
                    </span>
                  )}
                </div>
              )}

              {/* The one thing the netting cannot decide for the two of you. Their coupons come off what
              you owe them ONLY if they agree to that; they may want the mesos and to give the
              coupons back. So it is an act with a price on it, never an assumption, and until
              somebody records one the pieces stay a count. Same act as the purchase on the Sale
              Ledger, from the other end: see V50 and V56.

              Drawn beside the lists rather than inside one of them: a pill has nowhere else to be
              taken back, so it must not go with the heading above it when that heading goes. */}
              {keptRows.length > 0 && (
                <span className="ledger-tranches">
                  {keptRows.map((tranche) => (
                    <span key={tranche.id} className="ledger-tranche">
                      {`${tranche.pieces} kept for ${formatMesos(tranche.amount ?? 0, true)}`}
                      <button
                        type="button"
                        className="link ledger-drop-sale"
                        disabled={busy}
                        onClick={() => void write(onRemoveKeep(tranche.id), null)}
                        aria-label={`Remove ${tranche.pieces} coupons ${row.name} kept`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </span>
              )}
              {row.pieces > 0 && (
                <form
                  className="ledger-sale"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (keeps)
                      void write(onKeepPieces(row.holder, row.pieces, keeps), () => setKept(""));
                  }}
                >
                  <label className="loot-share-input">
                    {`${row.name} keeps ${row.pieces} for`}
                    <input
                      className="split-input"
                      value={kept}
                      onChange={(e) => setKept(e.target.value)}
                      placeholder="400m"
                      inputMode="decimal"
                      aria-label={`What ${row.name} pays to keep the ${row.pieces} coupons of yours`}
                    />
                  </label>
                  <button type="submit" className="party-save" disabled={busy || keeps === null}>
                    Add
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {/* Every act the card offers, in one place, each beside what pressing it will record.

          They were scattered across the steps they acted on, which put two buttons wearing the word
          Offset on one card and "Mark Sent" a step above "I paid them" for the same errand. What an
          act moves is now said in its line instead, so the step is a list of what can be done and
          the steps above are a statement of what stands.

          Last on the card on purpose: it is what you do about the figures, so it comes after all of
          them. */}
      {(offsettable || sendable || pair.offered) && (
        <div className="ledger-entry">
          <span className="ledger-heading">Closing Actions</span>

          {/* Discharged against what they owe you, rather than by money crossing.

              What YOU owe, and only that. Handed every line it also marked their shares to you paid,
              so the offset quietly collected money nobody had sent: the net fell by whatever they
              owed. Settle is the act that covers both directions, because there a transfer of the
              difference really did happen. */}
          {offsettable && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(offsetAll(), null)}
              >
                Offset
              </button>
              {/* What it leaves behind, where their debt cannot cover the shares. Said, because the
                  alternative is a button promising to take 800m off a 500m debt. Only where the
                  shares are the whole act: with their money in it too the remainder is a subtraction
                  across two pots, and this card does not make that one. */}
              <span className="ledger-progress">
                {offset.leftOwing > 0 && row.holding === 0
                  ? `clears what ${row.name} owes you, leaving you owing ${formatMesos(offset.leftOwing, true)}`
                  : `takes ${moved(offset.offered ? offset.amount : 0)} off what ${row.name} owes you`}
              </span>
            </span>
          )}

          {/* You actually sent them the mesos. Named for the direction, so it cannot be read as the
              collecting act below it or as the offset above. */}
          {sendable && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(sendAll(), null)}
              >
                Mark Sent
              </button>
              <span className="ledger-progress">
                {`records ${movedBoth(owes, row.usd.owe)} sent to ${row.name}`}
              </span>
            </span>
          )}

          {/* The coupons, both sides at once. Closing a single side is what took your own out of the
              netting and answered "60 to hand over" by asking for 80. See settleThePair. */}
          {pair.offered && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(onSettlePair(row.holder, pair.theirs, pair.yours), null)}
              >
                Mark Settled
              </button>
              {/* WHAT it closes, not how much of it. Counting the nights back read as a second fact
                  matching nothing else on the card (22 was eleven rows in each pile), and a count of
                  coupons would overclaim: a night shared with a third person is not closed here, and
                  that is said with the lists themselves. Both sides is the fact worth carrying,
                  closing one alone being what put the figure UP. See settleThePair. */}
              <span className="ledger-progress">closes the coupon nights on both sides</span>
            </span>
          )}
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}

/** The day part of a timestamp, this list being a history of days rather than of minutes. */
const dayOf = (at: string) => formatDropped(at.slice(0, 10));

/**
 * One act that came off, read the way every other drop row on this account is read.
 *
 * An offset covers ONE share, so the act row used to be a free-text note and a count with the night
 * itself a second fold down: two clicks to reach "which drop was that", and the middle row saying
 * nothing but "offset against Bro". Where there is one share, its drop IS the row.
 *
 * Several shares still fold, for the entries written while one press wrote one entry over all of
 * them. Offset records a row per share now, so nothing new arrives in that shape.
 * A coupon sale has no night, a tranche naming a person and never a boss, so it opens onto the sales
 * instead: what was sold, for what, and when. It reached the card as the bare word "coupon sale"
 * beside 2.41b, and nothing anywhere said that was 130 coupons over two nights.
 */
function DischargeRow({
  act,
  name,
  shares,
  iconUrl,
  busy,
  signed,
  onRemove,
}: {
  act: Discharge;
  name: string;
  shares: OffsetShare[];
  /** The coupon's own sprite, for the rows whose every piece is one. See CouponSale. */
  iconUrl: string | null;
  busy: boolean;
  signed: (mesos: number) => string;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const one = shares.length === 1 ? shares[0]! : null;
  const oneSale = act.sales.length === 1 ? act.sales[0]! : null;
  // What the act was made of, where it is made of coupons. The count the row was missing.
  const pieces = act.sales.reduce((sum, sale) => sum + sale.pieces, 0);
  // Anything the row cannot hold on one line. A single night or a single sale IS the row, so only a
  // group of either opens.
  const folds = shares.length > 1 || act.sales.length > 1;
  // The drop's own art where there is one drop, and the coupon's where the act is coupons: every
  // piece of a sale is one, so there is no other sprite it could be.
  const art = one?.iconUrl ?? (pieces > 0 ? iconUrl : null);

  /**
   * What the row cannot hold, on hover rather than on it.
   *
   * The row carries the figure, the art, what fell and the day, and those are what it is scanned for.
   * The boss, who was there and what the lot made are three more things: on the line they wrapped it
   * onto two and then three, and a history you cannot scan is a history nobody reads.
   */
  const behind = (
    one
      ? [
          one.boss,
          one.members.join(", "),
          one.on && formatDropped(one.on),
          // The lot it came out of, so the share can be checked against it rather than taken on
          // trust. Absent on a drop that never sold, which owes nobody anything.
          one.sale !== null && `sold for ${formatMesos(one.sale, true)}`,
        ]
      : oneSale
        ? [
            // The lot behind the share, which is the same check the drop rows offer. Where the whole
            // lot was theirs the two figures are one, so quoting both would say it twice.
            oneSale.pieces === oneSale.lot.pieces
              ? "the whole lot"
              : `${oneSale.pieces} of a ${oneSale.lot.pieces} coupon lot`,
            `sold for ${formatMesos(oneSale.lot.amount, true)}`,
          ]
        : [
            shares.length > 1 && `${shares.length} nights`,
            act.sales.length > 1 && `${act.sales.length} sales`,
          ]
  )
    .filter(Boolean)
    .join(" · ");
  const panelId = `act-${act.id}`;

  return (
    <li className="ledger-drop">
      {/* ONE LINE. The row is a history entry and a history is scanned, so what it must hold is the
          figure, the art, what fell and the day it came off. Everything else is the title above. */}
      <div className="ledger-drop-head is-oneline" title={behind || undefined}>
        {art ? (
          <img className="loot-icon" src={apiAssetUrl(art)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}

        {one && one.lootId ? (
          // The drop's own history, not its party's. What came off here is one night's share, and
          // the party is every night that boss ever gave you.
          <Link href={`/bosses/drops/${one.lootId}`} className="loot-name has-detail">
            {one.item}
          </Link>
        ) : (
          <span className="loot-name has-detail">
            {one ? one.item : pieces > 0 ? `${pieces} coupons sold` : act.label}
          </span>
        )}

        {/* The day the act was recorded, on every row and meaning the same thing on every row. It is
            what tells two offsets against one person apart, and it was in the title where nothing
            said there was a title. NOT the day the drop fell, which is a different fact and stays
            on hover: one column cannot mean two things down one list. */}
        <span className="loot-meta ledger-when">{dayOf(act.at)}</span>

        {/* After what it is and when, not in front of the art. Given a column of its own at the
            row's edge it held 28px open on every row in the list, and only some of them fold. It
            goes after the date rather than between it and the name, which are drawn tight together
            on purpose. */}
        {folds && (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            {/* Named, because a screen reader gets no chevron and no count off the row: whichever
                list is behind this one is what opening it reads out. */}
            <span className="visually-hidden">
              {`${open ? "Hide" : "Show"} the ${
                shares.length > 1 ? `${shares.length} nights` : `${act.sales.length} sales`
              }`}
            </span>
          </button>
        )}

        <span className="ledger-amount">{signed(-act.amount)}</span>
        <button
          type="button"
          className="link ledger-drop-sale"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Undo ${formatMesos(act.amount, true)} off what ${name} owes you`}
        >
          ×
        </button>
      </div>

      {open && folds && (
        <ul className="loot-shares" id={panelId}>
          {shares.map((share) => (
            <li key={share.key}>
              {/* The art the rest of the account reads drops by. The row above carries it, and a
                  list of drops that drops the icons is the one place on this card you cannot tell
                  two grindstones apart at a glance. */}
              {share.iconUrl ? (
                <img className="loot-icon" src={apiAssetUrl(share.iconUrl)} alt="" />
              ) : (
                <span className="loot-icon" aria-hidden="true" />
              )}
              <span className="loot-share-name">
                {share.lootId ? (
                  <Link href={`/bosses/drops/${share.lootId}`} className="loot-name">
                    {share.item}
                  </Link>
                ) : (
                  share.item
                )}
              </span>
              <span className="loot-share-nets">
                {[share.boss, share.on && formatDropped(share.on)].filter(Boolean).join(" · ")}
              </span>
              <span className="ledger-amount">{signed(-share.share)}</span>
            </li>
          ))}
          {/* Keyed by position: a tranche's id is not carried this far, and it has nothing to say
              here that its pieces and its day do not. */}
          {act.sales.map((sale, i) => (
            <li key={`sale-${i}`}>
              <span className="loot-share-name">{`${sale.pieces} coupons`}</span>
              <span className="loot-share-nets">
                {[
                  sale.soldAt && dayOf(sale.soldAt),
                  // Only where the sale was not all theirs. Their share of a mixed lot is a figure
                  // nobody can check without the lot it was divided out of.
                  sale.pieces !== sale.lot.pieces &&
                    `of ${sale.lot.pieces} for ${formatMesos(sale.lot.amount, true)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="ledger-amount">{signed(-sale.mesos)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One side's nights, whichever inventory they are in.
 *
 * Both lists are the same row, so they are one component: two copies would be two places for the
 * boss label and the week to drift apart, on a card whose whole point is that the two sides are the
 * same debt read from opposite ends.
 */
function PieceNights({
  drops,
  bossByKey,
  partyById,
}: {
  drops: HeldOfYours[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
}) {
  return (
    <ul className="ledger-queue">
      {/* A night a sale answered for, or one the other side cancelled, is at zero, and it is still one
          of the nights closing the pair would close: it is kept in the list for that and drawn in
          none. See spendOldestFirst. */}
      {drops
        .filter((drop) => drop.pieces > 0)
        .map((drop) => {
          const boss = bossByKey.get(drop.bossKey ?? "");
          const party = partyById.get(drop.partyId);
          return (
            <li key={`${drop.lootId}:${drop.pieces}`} className="ledger-drop">
              {/* One line. The parts are a boss, a looter, a week and a count, and wrapped they
                  came out two rows tall each, so a pile of nights stopped being scannable. Same
                  treatment, same reason, as the history entries. */}
              <div className="ledger-drop-head is-oneline">
                <Link href={partyHrefById(drop.partyId, partyById)} className="loot-name">
                  {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                </Link>
                <span className="loot-meta">
                  {drop.looterName} · week of {formatWeekStart(drop.weekStart)}
                  {/* Why this one is not in the count above. Said on the row it belongs to, rather
                      than as a second sentence under the button. */}
                  {drop.shared && " · owes somebody else too"}
                </span>
                <span className="ledger-amount">{drop.pieces}</span>
              </div>
            </li>
          );
        })}
    </ul>
  );
}

/**
 * A discard that takes two clicks.
 *
 * What it removes under `owed` is the one thing on this card nothing else recorded: a debt and a
 * receipt are typed, with a note and a day, and neither can be derived back. The card's other
 * discards undo an act whose own drop or sale still holds it, so those stay one click.
 *
 * Armed in place rather than behind a dialog, because the row is one line and a modal over a list
 * of cards is heavier than what it guards. Blur disarms, so a click anywhere else leaves nothing
 * armed behind it, and the WORD changes: hover already paints the button red, so colour alone
 * could not have said which state it was in.
 */
function ArmedRemove({
  label,
  busy,
  onRemove,
}: {
  label: string;
  busy: boolean;
  onRemove: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <button
      type="button"
      className={armed ? "link ledger-drop-sale is-armed" : "link ledger-drop-sale"}
      disabled={busy}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onRemove();
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
      aria-label={armed ? `Confirm: ${label}` : label}
    >
      {armed ? "Remove?" : "×"}
    </button>
  );
}

/**
 * One entered adjustment, opening onto the shares it discharged.
 *
 * A hand-typed debt names none and draws as a plain row. An OFFSET names as many as it covered, and
 * folds: the flat list then grows by one row per offset however many nights went into it, which is
 * what keeps a card with hundreds of them readable.
 */
/**
 * One debt somebody typed.
 *
 * No fold and no shares any more: an entry that names a share is a DISCHARGE and is drawn under
 * `offsets` by DischargeRow, which puts the drop itself on the row rather than a note and a
 * count. What is left here names nothing, so the chevron never had anything to open.
 */
function EnteredRow({
  entry,
  name,
  busy,
  signed,
  onRemove,
}: {
  entry: SettlementDebt;
  name: string;
  busy: boolean;
  signed: (mesos: number) => string;
  onRemove: () => void;
}) {
  return (
    <li className="ledger-drop">
      <div className="ledger-drop-head">
        {/* No empty toggle frame. It was kept to line this up with a folded row, but the folds are
            all under `offsets` and nothing in THIS list has one, so the frame indented the only row
            wearing it by 28px (18px of toggle and the head's 10px gap) past the parts above it. */}
        {/* Its own class: this is the one name on the card nobody chose the length of. See
            `.loot-name.is-note`. */}
        <span className="loot-name is-note">{entry.note ?? "entered"}</span>
        <span className="ledger-amount">{signed(entry.amount)}</span>
        <ArmedRemove
          busy={busy}
          label={`Remove ${formatMesos(entry.amount, true)} against ${name}`}
          onRemove={onRemove}
        />
      </div>
    </li>
  );
}
