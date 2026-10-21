"use client";

import { formatWeekStart, weekLabel } from "@/lib/boss-clears";
import { stepThrough } from "@/lib/week-steps";
import type { BossClearsView } from "@/types/boss";

/** The arrows, the label and the way back. Where the weeks come from is the caller's. */
function WeekSteps({
  label,
  onPrevious,
  onNext,
  back,
  busy,
}: {
  label: string;
  /** Null disables the arrow. */
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  /** The button back to where stepping starts, or null when already there. */
  back: { label: string; onClick: () => void } | null;
  busy?: boolean;
}) {
  return (
    <div className="week-stepper">
      <button
        type="button"
        className="week-step"
        onClick={() => onPrevious?.()}
        disabled={busy || !onPrevious}
        aria-label="Previous week"
      >
        ‹
      </button>

      {/* aria-live so stepping announces the week that arrived; the arrows themselves say nothing
          about where you landed. */}
      <span className="week-label" aria-live="polite">
        {label}
      </span>

      <button
        type="button"
        className="week-step"
        onClick={() => onNext?.()}
        disabled={busy || !onNext}
        aria-label="Next week"
      >
        ›
      </button>

      {back && (
        <button type="button" className="week-today" onClick={back.onClick} disabled={busy}>
          {back.label}
        </button>
      )}
    </div>
  );
}

/**
 * Steps the matrix through stored weeks.
 *
 * Both arrows are driven by the server's answer rather than by adding seven days here. An arrow is
 * disabled when the response says there is nothing that way: no stored week before this one, or
 * nowhere newer than the current period. Stepping into a week that was never captured would draw an
 * empty matrix, which is indistinguishable from a week where nothing was cleared.
 */
export function WeekStepper({
  view,
  onSelect,
  busy,
}: {
  view: Pick<
    BossClearsView,
    "weekStart" | "previousWeekStart" | "nextWeekStart" | "currentWeekStart"
  >;
  onSelect: (week: string | null) => void;
  busy?: boolean;
}) {
  const { weekStart, previousWeekStart, nextWeekStart, currentWeekStart } = view;

  // Stepping forward onto the week in progress means the live view, not a weekly-only slice of it:
  // asking for ?week=<current> would drop the daily and monthly rows off the bottom of the matrix.
  const forward = nextWeekStart === currentWeekStart ? null : nextWeekStart;

  return (
    <WeekSteps
      label={weekLabel(view)}
      onPrevious={previousWeekStart ? () => onSelect(previousWeekStart) : null}
      onNext={nextWeekStart ? () => onSelect(forward) : null}
      back={weekStart === null ? null : { label: "Today", onClick: () => onSelect(null) }}
      busy={busy}
    />
  );
}

/** The same control over a list of weeks, newest first, where "" is every week. See stepThrough. */
export function WeekFilter({
  weeks,
  shown,
  onSelect,
}: {
  weeks: string[];
  shown: string;
  onSelect: (week: string) => void;
}) {
  const { previous, next } = stepThrough(weeks, shown);
  return (
    <WeekSteps
      label={shown ? `Week of ${formatWeekStart(shown)}` : "All Weeks"}
      onPrevious={previous === null ? null : () => onSelect(previous)}
      onNext={next === null ? null : () => onSelect(next)}
      back={shown ? { label: "All Weeks", onClick: () => onSelect("") } : null}
    />
  );
}
