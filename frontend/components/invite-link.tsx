"use client";

import { useEffect, useState } from "react";
import { inviteUrl, timeLeft } from "@/lib/invite-link";
import type { Invite } from "@/types/invite";

/**
 * The link just made for one person.
 *
 * Only ever a fresh one, which is why there is a URL to show at all: the backend stores a hash, so
 * a link that was not copied is remade rather than looked up. There is no Revoke either. A link
 * expires on its own and making another deletes it, so nobody has to remember to switch one off.
 *
 * Handed a finished invite and shows it. It does not make one, so it cannot render half of
 * anything: opening on an empty box and filling it in afterwards read as a flicker. The wait for a
 * new link lives on the button that starts it. See invitePerson.
 */
export function InviteLink({
  person,
  invite,
  onClose,
}: {
  person: string;
  invite: Invite;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Ticks the countdown. Once a second is as fine as a seconds display can show, and the dialog is
  // the only thing on screen while it is open.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = invite.token != null ? inviteUrl(window.location.origin, invite.token) : null;
  const left = timeLeft(invite.expiresAt, now);

  async function copy() {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Refused without a user gesture in some browsers, and absent over plain http. The URL is on
      // screen and selectable either way, so there is nothing to report.
    }
  }

  return (
    <div className="invite-backdrop" role="presentation" onClick={onClose}>
      {/* The click that closes belongs to the backdrop alone, so one inside the box does not travel
          out to it and shut the dialog on the way. */}
      <div
        className="invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Invite ${person}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">Invite {person}</h2>

        {url !== null ? (
          <label className="invite-field">
            <span className="field-label">
              {invite.characterCount} {invite.characterCount === 1 ? "character" : "characters"},{" "}
              {invite.partyCount} {invite.partyCount === 1 ? "party" : "parties"}
            </span>
            <input
              className="split-input invite-url"
              value={url}
              readOnly
              aria-label="Link"
              autoFocus
              onFocus={(e) => e.target.select()}
            />
          </label>
        ) : (
          // Only reachable if the create response came back without a token, which is a backend
          // that changed under this. Say the link is not there rather than draw an empty box.
          <p className="invite-standing">Couldn&apos;t show that link. Try again.</p>
        )}

        {/* The clock, because a link this short outlives the conversation about it by less than you
            would guess. It runs out while the dialog is open, so what it says has to change. */}
        <p className={`invite-countdown${left === null ? " is-spent" : ""}`}>
          {left !== null ? `Expires in ${left}` : "Expired"}
        </p>

        <div className="invite-actions">
          {/* Nothing to copy once it is spent: handing somebody a dead address is worse than
              telling them there is none. */}
          {url !== null && left !== null && (
            <button type="button" className="party-save" onClick={copy}>
              {copied ? "Copied" : "Copy Link"}
            </button>
          )}
          <button type="button" className="party-cancel" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
