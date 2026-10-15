"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * A small "i" that opens a note on press, for a caveat too long for the screen itself.
 *
 * A button rather than a `title`: a title never opens on a touch screen or from the keyboard.
 * Closes on Escape and on a press anywhere outside it.
 */
export function InfoBubble({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span className="info-bubble" ref={box}>
      <button
        type="button"
        className="info-bubble-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <span id={id} role="note" className="info-bubble-panel">
          {children}
        </span>
      )}
    </span>
  );
}
