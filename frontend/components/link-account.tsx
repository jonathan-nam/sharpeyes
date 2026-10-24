"use client";

import { useState } from "react";
import { Tooltip } from "@/components/tooltip";
import type { PendingLink } from "@/types/party";

/**
 * Asks an existing account to be this person, by Discord username. An invite link is for somebody
 * with no account yet; this is for somebody who already has one.
 *
 * While the request waits, the row says who it went to and can take it back.
 */
export function LinkAccount({
  request,
  busy,
  unsaved,
  onSend,
  onCancel,
}: {
  request: PendingLink | null;
  busy: boolean;
  /** The request names the saved person, so an unsaved rename would link a name nobody sees. */
  unsaved: boolean;
  /** Resolves true when it was sent, which closes the box. */
  onSend: (username: string) => Promise<boolean>;
  onCancel: (requestId: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [username, setUsername] = useState("");

  if (request !== null) {
    return (
      <>
        <span className="party-hint">Sent to @{request.username ?? "?"}</span>
        <button
          type="button"
          className="party-cancel"
          disabled={busy}
          onClick={() => onCancel(request.id)}
        >
          Cancel Request
        </button>
      </>
    );
  }

  if (typing) {
    return (
      <form
        className="link-account"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend(username.trim()).then((sent) => {
            if (!sent) return;
            setTyping(false);
            setUsername("");
          });
        }}
      >
        <input
          type="text"
          className="split-input"
          value={username}
          placeholder="Discord username"
          aria-label="Discord username"
          disabled={busy}
          autoFocus
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit" className="person-invite" disabled={busy || !username.trim()}>
          Send Request
        </button>
        <button
          type="button"
          className="party-cancel"
          disabled={busy}
          onClick={() => {
            setTyping(false);
            setUsername("");
          }}
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <Tooltip text={unsaved ? "Save first" : undefined}>
      <button
        type="button"
        className="person-invite"
        disabled={busy || unsaved}
        onClick={() => setTyping(true)}
      >
        Link Account
      </button>
    </Tooltip>
  );
}
