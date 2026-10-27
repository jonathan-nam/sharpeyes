"use client";

import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { bossLabel } from "@/lib/boss-difficulty";
import { Button } from "@/components/button";
import { sectionHref, settlementCardHref } from "@/lib/drop-sections";
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
 * needs an answer brings its buttons, and is cleared by answering; one without gets a `go` button
 * where there is somewhere to look. Every entry can also be dismissed (NotificationBell).
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
  go?: { label: (payload: Payload) => string; href: (payload: Payload) => string };
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

/**
 * The Settlement card the payload names (backend PartyNotices.kt and SettlementListings.kt), or the
 * Settlement stage for an entry written before it named one.
 */
const viewSettlement = {
  label: () => "View Settlement",
  href: (p: Payload) =>
    p.personId ? settlementCardHref(str(p.personId)) : sectionHref("settlement"),
};

const KINDS: Record<string, Kind> = {
  FRIEND_REQUEST: { title: "Friend Request", actions: FriendRequestActions },
  FRIEND_ACCEPTED: {
    title: "Friend Request Accepted",
    go: { label: () => "View Friends", href: () => "/social" },
  },
  PARTY_INVITE: {
    text: (p, who) => `${who} invited ${str(p.character)} to ${partyOf(p)}`,
    actions: PartyInviteActions,
  },
  PARTY_INVITE_ANSWERED: {
    text: (p, who) =>
      p.accepted
        ? `${who} joined ${partyOf(p)} as ${str(p.character)}`
        : `${who} declined ${partyOf(p)}`,
    go: {
      label: (p) => (p.accepted ? "View Party" : "View Parties"),
      href: (p) => (p.accepted ? partyPage(p) : "/bosses/parties"),
    },
  },
  SALE_RECORDED: {
    text: (p, who) => `${who} sold ${str(p.item)} for ${priceOf(p)}`,
    icon: artOf,
    go: viewSettlement,
  },
  SPLIT_UPDATED: {
    text: (p, who) => `${who} owes you ${priceOf(p)}`,
    go: viewSettlement,
  },
  LISTING_POSTED: {
    text: (p, who) => `${who} posted a listing for ${priceOf(p)}`,
    go: viewSettlement,
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
      <Button variant="primary" disabled={busy} onClick={() => answer(true)}>
        Accept
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => answer(false)}>
        Decline
      </Button>
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
      accept ? "Couldn't accept." : "Couldn't reject.",
    );
  return (
    <>
      <Button variant="primary" disabled={busy} onClick={() => answer(true)}>
        Accept
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => answer(false)}>
        Reject
      </Button>
    </>
  );
}
