"use client";

import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { BOSS_ART, BOSS_ART_2X } from "@/lib/boss-art";
import { bossLabel } from "@/lib/boss-difficulty";
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
 * what changed (the drop, the boss) where it has some. See backend PartyNotices.kt.
 */
type Kind = {
  title?: string;
  actions?: (props: KindActions) => ReactNode;
  /** The sentence, given who did it. */
  text?: (payload: Payload, who: string) => string;
  /** Backend-relative art for what changed. */
  icon?: (payload: Payload) => string | null;
  /** Set on the icon, for art that is not a 46px drop icon. */
  iconClass?: string;
  href?: (payload: Payload) => string;
};

type Payload = AppNotification["payload"];

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);

const artOf = (p: Payload) => str(p.icon) || null;

/** The 80px portrait for the 26px one the payload names, which is drawn here at a drop's 46. */
function bossArtOf(p: Payload): string | null {
  const key = Object.keys(BOSS_ART).find((k) => BOSS_ART[k] === p.icon);
  return (key && BOSS_ART_2X[key]) || artOf(p);
}
const partyPage = (p: Payload) => `/bosses/parties/${encodeURIComponent(str(p.partyId))}`;

function priceOf(p: Payload): string {
  if (typeof p.usdCents === "number") return formatDollars(p.usdCents);
  return typeof p.amount === "number" ? shortMesos(p.amount) : "";
}

function shareText(p: Payload, who: string): string {
  if (typeof p.count === "number") {
    const shares = p.count === 1 ? "1 share" : `${p.count} shares`;
    return p.how === "OFFSET" ? `${who} offset ${shares}` : `${who} marked ${shares} sent`;
  }
  return `${who} marked a ${str(p.item)} share ${p.paid ? "paid" : "unpaid"}`;
}

function clearText(p: Payload, who: string): string {
  const boss = bossLabel(str(p.boss) || "a boss", str(p.difficulty) || null);
  return p.cleared ? `${who} cleared ${boss}` : `${who} unmarked ${boss}`;
}

function ledgerText(p: Payload, who: string): string {
  const amount = shortMesos(num(p.amount));
  if (p.entry === "payment") {
    return p.toYou
      ? `${who} recorded ${amount} paid to you`
      : `${who} recorded ${amount} paid by you`;
  }
  return p.toYou ? `${who} recorded ${amount} owed to you` : `${who} recorded ${amount} you owe`;
}

/** The party an invite is about, as the bell names it: the leader's character and the boss. */
function partyOf(p: Payload): string {
  const boss = bossLabel(str(p.boss) || "a boss", str(p.difficulty) || null);
  return p.leader ? `${str(p.leader)}'s ${boss}` : boss;
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
  SALE_RECORDED: {
    text: (p, who) => `${who} sold ${str(p.item)} for ${priceOf(p)}`,
    icon: artOf,
    href: partyPage,
  },
  SHARE_MARKED: {
    text: shareText,
    icon: artOf,
    href: (p) => (p.partyId ? partyPage(p) : "/bosses/drops"),
  },
  STACKS_CHANGED: {
    text: (p, who) => `${who} updated the stacks on ${str(p.item)}`,
    icon: artOf,
    href: partyPage,
  },
  CLEAR_MARKED: { text: clearText, icon: bossArtOf, iconClass: "is-boss", href: partyPage },
  LEDGER_ENTRY: { text: ledgerText, href: () => "/bosses/drops" },
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
