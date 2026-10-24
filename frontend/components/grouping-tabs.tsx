"use client";

import type { ReactNode } from "react";

// The filter bar Party View draws above its parties, shared so the Party Planner's reads the same.

/** The "Filter Options" section: a title, then its rows of tabs side by side. */
export function FilterOptions({ children }: { children: ReactNode }) {
  return (
    <section className="party-filters">
      <h2 className="party-filters-title">Filter Options</h2>
      <div className="party-toolbar-tabs">{children}</div>
    </section>
  );
}

/** What a list of parties is grouped by, as a row of tabs. One is always chosen. */
export function GroupingTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="basis-row" role="group" aria-label="Group parties by">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "basis-tab active" : "basis-tab"}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
