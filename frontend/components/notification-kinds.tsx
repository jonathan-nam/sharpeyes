"use client";

import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { bossLabel } from "@/lib/boss-difficulty";
import { sectionHref } from "@/lib/drop-sections";
import { shortMesos } from "@/lib/drop-split";
import { formatDollars } from "@/lib/money";
import { friendsChanged } from "@/lib/friends-changed";
import type { AppNotification } from "@/types/notifications";

/** What a kind's buttons get: the notification, and a way to run a write with the bell's busy and error. */
type TokenGetter = () => Promise<string | null>;

export type KindActions = {
  notification: AppNotification;
  busy: boolean;
  run: (write: (getToken: TokenGetter) => Promise<unknown>, failure: string) => void;
};

/**
 * How each kind is drawn. A new kind is one entry here and one `notify` on the backend. One that
 * needs an answer brings its buttons and is cleared by answering; one without gets a dismiss.
 *
 * A change somebody made to something shared is a sentence instead of a title, beside the art of
 * what changed (the drop) where it has some. See backend PartyNotices.kt.
 */
type Kind = {
  title?: string;
  actions?: (props: KindActions) => ReactNode;
  /** The sentence, given who did it. */
  text?: (payload: Payload, who: string) => string;
  /** Backend-relative art for what changed. */
  icon?: (payload: Payload) => string | null;
  href?: (payload: Payload) => string;
};

type Payload = AppNotification["payload"];

const str = (value: unknown) => (typeof value === "string" ? value : "");

const artOf = (p: Payload) => str(p.icon) || null;

const partyPage = (p: Payload) => `/bosses/parties/${encodeURIComponent(str(p.partyId))}`;

function priceOf(p: Payload): string {
  if (typeof p.usdCents === "number") return formatDollars(p.usdCents);
  return typeof p.amount === "number" ? shortMesos(p.amount) : "";
}

/** The party an invite is about, as the bell names it: the leader's character and the boss. */
function partyOf(p: Payload): string {
  const boss = bossLabel(str(p.boss) || "a boss", str(p.difficulty) || null);
  return p.leader ? `${str(p.leader)}'s ${boss}` : boss;
}

/** "18 parties", from a combine's payload. */
function partiesCount(p: Payload): string {
  const n = typeof p.count === "number" ? p.count : 0;
  return `${n} ${n === 1 ? "party" : "parties"}`;
}

const KINDS: Record<string, Kind> = {
  FRIEND_REQUEST: { title: "Friend Request", actions: FriendRequestActions },
  FRIEND_ACCEPTED: { title: "Friend Request Accepted" },
  PARTY_INVITE: {
    text: (p, who) => `${who} invited ${str(p.character)} to ${partyOf(p)}`,
    actions: PartyInviteActions,
  },
  PARTY_INVITE_ANSWERED: {
    text: (p, who) =>
      p.accepted
        ? `${who} joined ${partyOf(p)} as ${str(p.character)}`
        : `${who} declined ${partyOf(p)}`,
    href: (p) => (p.accepted ? partyPage(p) : "/bosses/parties"),
  },
  PARTY_COMBINE: {
    text: (_, who) => `${who} has requested to combine parties.`,
    href: () => "/social",
  },
  PARTY_COMBINED: {
    text: (p, who) => `${who} combined ${partiesCount(p)}`,
    href: () => "/bosses/parties",
  },
  SALE_RECORDED: {
    text: (p, who) => `${who} sold ${str(p.item)} for ${priceOf(p)}`,
    icon: artOf,
    href: partyPage,
  },
  // Backend SettlementListings.kt. Both open the Settlement stage, where the card is.
  SPLIT_UPDATED: {
    text: (p, who) => `${who} owes you ${priceOf(p)}`,
    href: () => sectionHref("settlement"),
  },
  LISTING_POSTED: {
    text: (p, who) => `${who} posted a listing for ${priceOf(p)}`,
    href: () => sectionHref("settlement"),
  },
};

/** Null for a kind this build does not know, which the bell leaves out rather than guesses at. */
export function kindOf(kind: string): Kind | null {
  return KINDS[kind] ?? null;
}

function PartyInviteActions({ notification, busy, run }: KindActions) {
  const path = `/api/party-invites/${encodeURIComponent(notification.subjectId ?? "")}`;
  const answer = (accept: boolean) =>
    run(
      async (getToken) => {
        await apiFetch<unknown>(
          accept ? `${path}/accept` : path,
          { method: accept ? "POST" : "DELETE" },
          getToken,
        );
        // A seat gained shows on Party View, Run Order and Sales.
        if (accept) invalidate("/api/parties");
      },
      accept ? "Couldn't join." : "Couldn't decline.",
    );
  return (
    <>
      <button type="button" className="party-save" disabled={busy} onClick={() => answer(true)}>
        Accept
      </button>
      <button type="button" className="party-cancel" disabled={busy} onClick={() => answer(false)}>
        Decline
      </button>
    </>
  );
}

function FriendRequestActions({ notification, busy, run }: KindActions) {
  const path = `/api/friends/requests/${encodeURIComponent(notification.subjectId ?? "")}`;
  const answer = (accept: boolean) =>
    run(
      async (getToken) => {
        await apiFetch<unknown>(
          accept ? `${path}/accept` : path,
          { method: accept ? "POST" : "DELETE" },
          getToken,
        );
        // A friendship changes people and every party that seats them.
        invalidate("/api/people");
        invalidate("/api/parties");
        friendsChanged();
      },
      accept ? "Couldn't accept." : "Couldn't decline.",
    );
  return (
    <>
      <button type="button" className="party-save" disabled={busy} onClick={() => answer(true)}>
        Accept
      </button>
      <button type="button" className="party-cancel" disabled={busy} onClick={() => answer(false)}>
        Decline
      </button>
    </>
  );
}
