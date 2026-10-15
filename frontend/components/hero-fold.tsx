"use client";

import { useId, useState, type ReactNode } from "react";

/** A home screen row that folds open: a toggle, its caret, and what it unfolds. */
export function HeroFold({
  head,
  panelClassName,
  children,
}: {
  head: ReactNode;
  panelClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="hero-fold">
      <button
        type="button"
        className="hero-fold-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {head}
        <span className="party-row-chevron hero-fold-caret" aria-hidden="true" />
      </button>
      <div id={panelId} className={panelClassName} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
