"use client";

import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cache";
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
 */
type Kind = { title: string; actions?: (props: KindActions) => ReactNode };

const KINDS: Record<string, Kind> = {
  FRIEND_REQUEST: { title: "Friend Request", actions: FriendRequestActions },
  FRIEND_ACCEPTED: { title: "Friend Request Accepted" },
};

/** Null for a kind this build does not know, which the bell leaves out rather than guesses at. */
export function kindOf(kind: string): Kind | null {
  return KINDS[kind] ?? null;
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
