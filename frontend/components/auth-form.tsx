"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

/**
 * The shell every auth page shares: a heading, fields, one button, one error line.
 *
 * Shared because these four pages differ only in their fields and what submit does, and four
 * hand-rolled copies of the same busy-and-error handling is four places for them to disagree.
 */
export function AuthForm({
  title,
  submitLabel,
  onSubmit,
  children,
  footer,
  done,
}: {
  title: string;
  submitLabel: string;
  onSubmit: () => Promise<string | null>;
  children: ReactNode;
  footer?: ReactNode;
  done?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await onSubmit();
      if (failure) setError(failure);
      else if (done) setFinished(true);
    } catch {
      // Anything that never reached the server. Named as such rather than reported as a rejection,
      // which would send somebody to check their password over a dropped connection.
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (finished && done) {
    return (
      <section className="auth-panel">
        <h1>{title}</h1>
        <p className="auth-done">{done}</p>
      </section>
    );
  }

  return (
    <section className="auth-panel">
      <h1>{title}</h1>
      <form onSubmit={submit}>
        {children}
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "..." : submitLabel}
        </button>
      </form>
      {footer ? <p className="auth-footer">{footer}</p> : null}
    </section>
  );
}

export function AuthField({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: "email" | "password" | "text";
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        required
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
