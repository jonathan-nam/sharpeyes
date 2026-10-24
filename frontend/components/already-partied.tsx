"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { alreadyPartiedText, onAlreadyPartied } from "@/lib/invite-notice";

/** The pop-up for a friend a save could not invite. Mounted once, in the layout. See invite-notice. */
export function AlreadyPartied() {
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => onAlreadyPartied(setNames), []);
  useEffect(() => {
    if (!names) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNames(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [names]);

  if (!names) return null;
  const close = () => setNames(null);
  return (
    <div className="invite-backdrop" role="presentation" onClick={close}>
      <div
        className="invite-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Not Invited"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">Not Invited</h2>
        <p className="invite-standing">{alreadyPartiedText(names)}</p>
        <div className="invite-actions">
          <Button variant="primary" onClick={close} autoFocus>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
