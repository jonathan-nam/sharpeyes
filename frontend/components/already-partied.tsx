"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { onAlreadyPartied } from "@/lib/invite-notice";

/** The pop-up for friends a save asked about or left out. Mounted once, in the layout. See invite-notice. */
export function AlreadyPartied() {
  const [notices, setNotices] = useState<string[] | null>(null);

  useEffect(() => onAlreadyPartied(setNotices), []);
  useEffect(() => {
    if (!notices) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotices(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notices]);

  if (!notices) return null;
  const close = () => setNotices(null);
  return (
    <div className="invite-backdrop" role="presentation" onClick={close}>
      <div
        className="invite-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Not Added"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">Not Added</h2>
        {notices.map((notice) => (
          <p key={notice} className="invite-standing">
            {notice}
          </p>
        ))}
        <div className="invite-actions">
          <Button variant="primary" onClick={close} autoFocus>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
