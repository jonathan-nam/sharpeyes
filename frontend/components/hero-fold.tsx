"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A home screen row that folds open: a toggle, its caret, and what it unfolds.
 *
 * `lazy` mounts the panel on first open and then keeps it, so a widget fetches nothing until it is
 * asked for and folding it away does not throw out a half-typed price.
 */
export function HeroFold({
  head,
  panelClassName,
  lazy = false,
  children,
}: {
  head: ReactNode;
  panelClassName: string;
  lazy?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(!lazy);
  const panelId = useId();
  return (
    <div className="hero-fold">
      <button
        type="button"
        className="hero-fold-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
          setOpened(true);
        }}
      >
        {head}
        <span className="party-row-chevron hero-fold-caret" aria-hidden="true" />
      </button>
      <div id={panelId} className={panelClassName} hidden={!open}>
        {opened && children}
      </div>
    </div>
  );
}
