"use client";

import { type ReactNode, useEffect, useId, useState } from "react";

import { TipPanel } from "@/components/tooltip";

/**
 * A small "i" that opens a note on press, for a caveat too long for the screen itself.
 *
 * A button rather than a Tooltip: hover never happens on a touch screen. The note is drawn by the
 * Tooltip's own panel, so the two look alike. Closes on Escape and on a press outside both.
 */
export function InfoBubble({ label, children }: { label: string; children: ReactNode }) {
  // The button it is open on, or null when closed.
  const [at, setAt] = useState<HTMLButtonElement | null>(null);
  const open = at !== null;
  const id = useId();

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAt(null);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The note is in <body>, not under the button, so it is checked on its own.
      if (at.contains(target) || document.getElementById(id)?.contains(target)) return;
      setAt(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [at, id]);

  return (
    <span className="info-bubble">
      <button
        type="button"
        className="info-bubble-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          const button = e.currentTarget;
          setAt((current) => (current ? null : button));
        }}
      >
        i
      </button>
      {at && (
        <TipPanel id={id} anchor={at} role="note" className="tooltip is-note" prefer="below">
          {children}
        </TipPanel>
      )}
    </span>
  );
}
