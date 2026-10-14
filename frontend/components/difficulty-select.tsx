"use client";

import { difficultyLabel } from "@/lib/boss-difficulty";

/**
 * The mode a boss is run at, out of the ones the boss has.
 *
 * Empty is a real answer, not a prompt to be filled in: a config can predate the column, or the
 * group may not have settled on one. It is never defaulted to Normal, which would be the app saying
 * something nobody said.
 *
 * Shared by the party config editor and the routine list, which ask the same question of a party and
 * of a boss run alone. One copy, so the two cannot offer different modes or read empty differently.
 */
export function DifficultySelect({
  difficulties,
  value,
  label,
  disabled,
  required,
  onChange,
}: {
  difficulties: string[];
  value: string;
  label: string;
  disabled?: boolean;
  /** Where what a clear files depends on the mode: empty is flagged, and cannot be picked back. */
  required?: boolean;
  onChange: (difficulty: string) => void;
}) {
  const missing = required && value === "";
  return (
    <select
      className={`split-input config-difficulty${missing ? " is-missing" : ""}`}
      value={value}
      aria-label={label}
      aria-invalid={missing || undefined}
      disabled={disabled || difficulties.length === 0}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled={required}>
        difficulty...
      </option>
      {difficulties.map((difficulty) => (
        <option key={difficulty} value={difficulty}>
          {difficultyLabel(difficulty)}
        </option>
      ))}
    </select>
  );
}
