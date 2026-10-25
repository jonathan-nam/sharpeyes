"use client";

import { useState } from "react";
import { Button } from "@/components/button";

/**
 * A button that asks before it acts: one press opens the question, the act hangs off the second.
 * For what one account cannot take back on its own, like leaving, disbanding or removing a member.
 */
export function ConfirmAct({
  label,
  question,
  keep,
  busy,
  onConfirm,
}: {
  /** What the button says at rest. */
  label: string;
  /** What it asks once pressed, and what pressing it again does. */
  question: string;
  /** The way back out. */
  keep: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <>
      <button type="button" className="party-delete" onClick={onConfirm} disabled={busy}>
        {question}
      </button>
      <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
        {keep}
      </Button>
    </>
  ) : (
    <button type="button" className="party-delete" onClick={() => setAsking(true)} disabled={busy}>
      {label}
    </button>
  );
}
