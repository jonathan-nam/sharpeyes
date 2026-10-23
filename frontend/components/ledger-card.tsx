"use client";

import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { DiscordAvatar } from "@/components/discord-avatar";
import { apiAssetUrl } from "@/lib/api";
import { formatMesos } from "@/lib/drop-split";
import { formatPieces } from "@/lib/piece-ledger";

// The Settlement card's layout, ONE copy of it. The owner's card (settlement-ledger.tsx) and the
// member's card in somebody else's book (shared-cards.tsx) read different books with different
// arithmetic, so each works its own figures out; what they draw them with is here, so a change to
// how a card looks reaches both. The member's card missed a whole redesign for being a second copy.

/** The person, their figures beside them, and the way into the card's history. */
export function LedgerHead({
  lead,
  image,
  name,
  summary,
  onHistory,
}: {
  /** Before the person, like the owner's pin. */
  lead?: ReactNode;
  image: string | null;
  name: string;
  /** The card's figures, said in their own words. Drawn only when given. */
  summary?: ReactNode;
  /** Opens HistoryDialog. No button without it. */
  onHistory?: () => void;
}) {
  return (
    <header className="ledger-head">
      {lead}
      <span className="loot-name ledger-who is-large">
        <DiscordAvatar image={image} size="md" />
        {name}
      </span>
      {summary && <span className="loot-meta ledger-summary is-open">{summary}</span>}
      {/* What built the figure and what came off it: a history, which grows for as long as the two
          of you play, so it is a click away rather than the top half of the card. */}
      {onHistory && (
        <button type="button" className="party-cancel ledger-history-open" onClick={onHistory}>
          History
        </button>
      )}
    </header>
  );
}

/** What built the card's figure and what came off it, in a pop-up. Escape or Done closes it. */
export function HistoryDialog({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="invite-backdrop" role="presentation" onClick={onClose}>
      <div
        className="invite-dialog ledger-history"
        role="dialog"
        aria-modal="true"
        aria-label={`Settlement History with ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">Settlement History</h2>
        {children}
        <div className="invite-actions">
          <button type="button" className="party-cancel" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Everything standing open, under one heading, with the net on the heading's line where it is
 * read first. The net is the caller's to give or withhold: drawn only where the acts move it.
 */
export function UnsettledAmounts({
  net,
  children,
}: {
  net?: { name: string; mesos: number; toThem: boolean } | null;
  children: ReactNode;
}) {
  return (
    <div className="ledger-entry">
      <div className="ledger-step-line">
        <span className="ledger-heading">Unsettled Amounts</span>
        {net && (
          <span className="ledger-net">
            {net.toThem ? `Net to ${net.name} ` : `Net from ${net.name} `}
            <CopyAmount value={net.mesos} display={formatMesos(net.mesos, true)} />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * One direction's half: whose hands the money is in, its figure (copyable, being what gets pasted
 * into a trade box), and the drops it is made of under it. Two halves rather than one total,
 * because they run opposite ways (see V61, V91).
 */
export function HeldBy({
  label,
  mesos,
  children,
}: {
  label: string;
  mesos: number;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="ledger-step-line">
        <span className="ledger-step">{label}</span>
        {mesos > 0 && (
          <span className="ledger-amount">
            <CopyAmount value={mesos} display={formatMesos(mesos, true)} />
          </span>
        )}
      </div>
      {children}
    </>
  );
}

/** One share of a drop, as every drop row on this account reads. */
export type ShareLine = {
  key: string;
  iconUrl: string | null | undefined;
  name: string;
  /** The party page the drop is on, where there is one to go to. */
  href?: string;
  /** Boss and whose share, after the name. */
  meta?: string;
  /** Pre-fee, in its own unit: see settlement-figure. */
  money: string;
  /** An act on this one share, like Mark Received. */
  act?: ReactNode;
};

/** A drop's art, or the empty box in its place, so rows line up whatever is missing. */
export function DropIcon({ url }: { url: string | null | undefined }) {
  return url ? (
    <img className="loot-icon" src={apiAssetUrl(url)} alt="" />
  ) : (
    <span className="loot-icon" aria-hidden="true" />
  );
}

export function ShareRows({ lines }: { lines: ShareLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="ledger-queue">
      {lines.map((line) => (
        <li key={line.key} className="ledger-drop">
          <div className="ledger-drop-head">
            <DropIcon url={line.iconUrl} />
            {line.href ? (
              <Link href={line.href} className="loot-name">
                {line.name}
              </Link>
            ) : (
              <span className="loot-name">{line.name}</span>
            )}
            {line.meta && <span className="loot-meta">{line.meta}</span>}
            <span className="ledger-amount">{line.money}</span>
            {line.act}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Coupon sales whose money one side is holding, as ONE row: how many coupons, what they came to.
 * Two rows of 45 and 37.5 were one question, how much of the coupons' money is still out. The
 * sales add up to their side's figure exactly or are not given (see undecidedSales), so the sum
 * says nothing the rows did not.
 */
export function CouponTotal({
  sales,
  iconUrl,
  couponName,
  meta,
}: {
  sales: { pieces: number; mesos: number }[];
  iconUrl: string | null;
  couponName: string | null;
  /** Which bosses, where the caller can say. */
  meta?: string;
}) {
  if (sales.length === 0) return null;
  const pieces = sales.reduce((sum, sale) => sum + sale.pieces, 0);
  const mesos = sales.reduce((sum, sale) => sum + sale.mesos, 0);
  return (
    <ul className="loot-shares">
      <li className="loot-sale-row">
        <DropIcon url={iconUrl} />
        <div className="ledger-offset-text">
          <span className="loot-share-name">{`${formatPieces(pieces)} ${couponName ?? "coupons"}`}</span>
          <span className="ledger-offset-sub">
            <span className="ledger-amount">{formatMesos(mesos, true)}</span>
            {meta && <span className="loot-meta">{meta}</span>}
          </span>
        </div>
      </li>
    </ul>
  );
}

/** One closing act: its button, naming what pressing it records, and what it is about beside it. */
export type ClosingAct = {
  key: string;
  label: string;
  /** The drops and coupons it covers. One line. */
  detail?: string | null;
  /** Anything else beside it, like what an offset leaves owing. */
  after?: ReactNode;
  onClick: () => void;
};

/**
 * Every act the card offers, in one place, one to a row. Last on the card on purpose: it is what you
 * do about the figures, so it comes after all of them.
 */
export function ClosingActions({ acts, busy }: { acts: ClosingAct[]; busy: boolean }) {
  if (acts.length === 0) return null;
  return (
    <div className="ledger-entry">
      <span className="ledger-heading">Closing Actions</span>
      {acts.map((act) => (
        <span key={act.key} className="ledger-settle">
          <button type="button" className="party-save" disabled={busy} onClick={act.onClick}>
            {act.label}
          </button>
          {act.detail && <span className="ledger-progress">{act.detail}</span>}
          {act.after}
        </span>
      ))}
    </div>
  );
}
