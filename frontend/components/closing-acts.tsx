"use client";

import type { ClosingAct } from "@/components/ledger-card";
import { type ListingKit, ListingThumb } from "@/components/settlement-listing";
import { formatMesos } from "@/lib/drop-split";
import { formatDollars } from "@/lib/money";
import type { ClosingNet, ClosingShare } from "@/lib/settlement";
import type { ClosePots } from "@/types/vestige";
import type { SettlementListing } from "@/types/settlement-listing";

// Every closing act on a Settlement card, on both sides of it, from one netted figure (closingNet).
// The rules, agreed with Jonathan on 2026-10-25:
//   the side that owes net gets Mark X Sent, and Offset where an entered debt can take it;
//   the side owed gets Mark X Received and Post Listing, and Offset the other way round;
//   an even pair gets Mark Settled;
//   every one of them settles all four pots both ways, in one write.
// And a keep (2026-10-26): the side owed, holding the other's money while the other also owes it
// outside the pots, may keep that money as an Offset on its own. Their coupon money and the meso
// shares of drops it sold alike (2026-10-27): a grindstone share held was left to cross.

export type CloseKind = "OFFSET" | "PAID";

const mesoOnly = (shares: ClosingShare[]) => shares.filter((share) => share.currency === "MESO");
const refs = (shares: ClosingShare[], priced: boolean) =>
  shares.map(({ lootId, memberId, amount }) =>
    priced ? { lootId, memberId, amount } : { lootId, memberId },
  );

/**
 * What one press sends, from [net] read on the side writing it. An Offset prices each share into an
 * entry, which is a meso ledger, so it takes the meso shares alone; Mark Sent takes every share.
 */
export function closeBody(net: ClosingNet, kind: CloseKind): ClosePots {
  const offset = kind === "OFFSET";
  const yours = offset ? mesoOnly(net.sharesYouOwe) : net.sharesYouOwe;
  const theirs = offset ? mesoOnly(net.sharesTheyOwe) : net.sharesTheyOwe;
  return {
    parts: refs(yours, offset),
    received: refs(theirs, offset),
    holding: net.holding > 0 ? net.holding : undefined,
    heldByThem: net.heldByThem > 0 ? net.heldByThem : undefined,
  };
}

/** Mesos and dollars, never added, there being no rate between them. */
const both = (mesos: number, cents: number) =>
  [mesos > 0 ? formatMesos(mesos, true) : null, cents > 0 ? formatDollars(cents) : null]
    .filter(Boolean)
    .join(" and ");

/** The one press's label: what crosses, which way, dollars named beside the mesos. */
export function closeLabel(net: ClosingNet): string {
  const sent = net.payer === "YOU" ? both(net.mesos, net.usdYouOwe) : both(0, net.usdYouOwe);
  const received = net.payer === "THEM" ? both(net.mesos, net.usdTheyOwe) : both(0, net.usdTheyOwe);
  const named = [sent && `${sent} Sent`, received && `${received} Received`].filter(Boolean);
  // The payer's direction first, so the button leads with what the reader is doing.
  if (net.payer === "THEM") named.reverse();
  return named.length > 0 ? `Mark ${named.join(", ")}` : "Mark Settled";
}

/** The listings on a card between linked accounts: who posted which, and what to do with them. */
export type ClosingListings = {
  kit: ListingKit;
  /** Yours, posted for them to pay. */
  yours: SettlementListing | null;
  /** Theirs, posted for you to pay. */
  theirs: SettlementListing | null;
  post: () => void;
  replace: (image: Blob) => Promise<void>;
  remove: () => void;
};

/** [net] cut to the money of theirs you hold, coupon money and meso shares, which is all a keep settles. */
export const heldOnly = (net: ClosingNet): ClosingNet => {
  const shares = mesoOnly(net.sharesYouOwe);
  return {
    ...net,
    mesos: shares.reduce((sum, share) => sum + share.amount, net.holding),
    sharesYouOwe: shares,
    sharesTheyOwe: [],
    heldByThem: 0,
    usdYouOwe: 0,
    usdTheyOwe: 0,
  };
};

export function closingActs({
  net,
  name,
  detail,
  heldDetail = null,
  close,
  listings,
}: {
  net: ClosingNet;
  /** The other side, for "Awaiting action from". */
  name: string;
  /** The drops and coupons the press covers, one line. */
  detail: string | null;
  /** The money of theirs you hold, one line, for the act that keeps it. */
  heldDetail?: string | null;
  /** [scope] narrows what the press settles; every act but the keep settles the whole of [net]. */
  close: (kind: CloseKind, scope?: ClosingNet) => void;
  listings?: ClosingListings;
}): ClosingAct[] {
  if (!net.open) return [];
  const amount = formatMesos(net.mesos, true);
  const press: ClosingAct = {
    key: "close",
    label: closeLabel(net),
    detail,
    after: net.payer === "YOU" && listings?.theirs && (
      <ListingThumb listing={listings.theirs} kit={listings.kit} />
    ),
    onClick: () => close("PAID"),
  };
  // Instead of the mesos crossing, they come off an entered debt running the other way.
  const offsetFits =
    (net.payer === "YOU" && net.enteredBalance > 0) ||
    (net.payer === "THEM" && net.enteredBalance < 0);
  const offset: ClosingAct = {
    key: "offset",
    label: net.payer === "YOU" ? `Offset ${amount}` : `Take ${amount} Off Owed Amount`,
    detail,
    after: net.payer === "YOU" && net.enteredBalance < net.mesos && (
      <span className="ledger-progress">
        {`You still owe ${formatMesos(net.mesos - net.enteredBalance, true)}`}
      </span>
    ),
    onClick: () => close("OFFSET"),
  };
  const listing: ClosingAct | null =
    net.payer === "THEM" && listings
      ? {
          key: "listing",
          label: `Post Listing for ${amount}`,
          disabled: listings.yours !== null,
          after: listings.yours && (
            <>
              <ListingThumb
                listing={listings.yours}
                kit={listings.kit}
                onReplace={listings.replace}
                onRemove={listings.remove}
              />
              <span className="ledger-progress">{`Awaiting action from ${name}`}</span>
            </>
          ),
          onClick: listings.post,
        }
      : null;
  // Their money in your hands, kept and taken off what they owe you, while the rest still crosses.
  // Where you owe net, the Offset above already takes it with everything else.
  const kept = heldOnly(net);
  const keep: ClosingAct | null =
    net.payer !== "YOU" && kept.mesos > 0 && net.enteredBalance > 0
      ? {
          key: "keep",
          label: `Offset ${formatMesos(kept.mesos, true)}`,
          detail: heldDetail,
          onClick: () => close("OFFSET", kept),
        }
      : null;
  return [
    ...(offsetFits ? [offset] : []),
    ...(keep ? [keep] : []),
    press,
    ...(listing ? [listing] : []),
  ];
}
