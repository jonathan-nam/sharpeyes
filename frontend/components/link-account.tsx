"use client";

import { useEffect, useState } from "react";
import { DiscordLookup, mayAsk, useDiscordLookup } from "@/components/discord-lookup";
import { Tooltip } from "@/components/tooltip";
import type { PendingLink } from "@/types/party";

/**
 * Asks an existing account to be this person, by Discord username. An invite link is for somebody
 * with no account yet; this is for somebody who already has one.
 *
 * While the request waits, the row says who it went to and can take it back.
 */
export function LinkAccount({
  person,
  request,
  busy,
  unsaved,
  onSend,
  onCancel,
}: {
  person: string;
  request: PendingLink | null;
  busy: boolean;
  /** The request names the saved person, so an unsaved rename would link a name nobody sees. */
  unsaved: boolean;
  /** Resolves to why it was refused, or null once sent, which closes the dialog. */
  onSend: (username: string) => Promise<string | null>;
  onCancel: (requestId: string) => void;
}) {
  const [open, setOpen] = useState(false);

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

  return (
    <>
      <Tooltip text={unsaved ? "Save first" : undefined}>
        <button
          type="button"
          className="person-invite"
          disabled={busy || unsaved}
          onClick={() => setOpen(true)}
        >
          Link Account
        </button>
      </Tooltip>
      {open && (
        <LinkAccountDialog
          person={person}
          busy={busy}
          onSend={onSend}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function LinkAccountDialog({
  person,
  busy,
  onSend,
  onClose,
}: {
  person: string;
  busy: boolean;
  onSend: (username: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const state = useDiscordLookup(username);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="invite-backdrop" role="presentation" onClick={onClose}>
      {/* A click inside the box must not travel out to the backdrop and close it. */}
      <div
        className="invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Link ${person}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">Link {person}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void onSend(username.trim()).then((refused) => {
              if (refused === null) onClose();
              else setError(refused);
            });
          }}
        >
          <DiscordLookup
            value={username}
            state={state}
            onChange={(next) => {
              setUsername(next);
              setError(null);
            }}
            disabled={busy}
            autoFocus
          />
          {error && <p className="routine-error">{error}</p>}
          <div className="invite-actions">
            <button
              type="submit"
              className="party-save"
              disabled={busy || !mayAsk(username, state)}
            >
              Send Request
            </button>
            <button type="button" className="party-cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
