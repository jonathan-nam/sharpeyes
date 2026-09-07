"use client";

import { useEffect, useState } from "react";

/**
 * An amount you can click to copy.
 *
 * Copies the RAW digits whatever the display is set to. The grouping toggle is for reading, and a
 * pasted "3,284,739,285" is not a price the game will accept.
 */
export function CopyAmount({
  value,
  display,
  copy,
}: {
  value: number;
  display: string;
  /**
   * What lands on the clipboard, when the raw value is not it. Dollars are held as CENTS, so a
   * share of 33334 pastes as 333.34 or it is a thousandfold overpayment typed by hand.
   */
  copy?: string;
}) {
  const text = copy ?? String(value);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={copied ? "copy-amount copied" : "copy-amount"}
      // Only report success if it actually copied: a silent failure that says "copied" is worse
      // than one that says nothing, because you paste whatever was in the clipboard before.
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      aria-label={`Copy ${text}`}
    >
      <span className="copy-value">{display}</span>
      <span className="copy-mark" aria-hidden="true">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
