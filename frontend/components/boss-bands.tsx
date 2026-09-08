"use client";

import { type BossBand, bandCount, bandFill, cadenceLabel, progressLabel } from "@/lib/boss-clears";

// The totals read the other way up from the table. The table follows the planner, which puts the
// rarest reset first; the totals are read at a glance, and the glance is nearly always at the week.
const TOTALS_ORDER = ["WEEKLY", "MONTHLY", "DAILY"];

/**
 * How much of each cadence is cleared, in the corner of the column heads.
 *
 * It had a strip of its own between the heads and the rows, which cost the table two bands of
 * height at the top of the page for something the head row already had room for: the corner cell
 * is as tall as a 96px sprite and held one word.
 *
 * The figures are handed in rather than counted here. They are the same numbers the marks below
 * are drawn from, and two counts of one set of clears is the disagreement this repo exists to
 * avoid: see bossBands().
 */
export function BossBands({ bands, loading }: { bands: BossBand[]; loading?: boolean }) {
  return (
    <span className="boss-band-totals">
      {[...bands]
        .sort((a, b) => TOTALS_ORDER.indexOf(a.cadence) - TOTALS_ORDER.indexOf(b.cadence))
        .map(({ cadence, progress }) => {
          const fill = bandFill(progress);
          return (
            <span key={cadence} className="boss-band-row">
              <span className="boss-band-name">{cadenceLabel(cadence)}</span>
              {/* The bar is a picture of the figure and the figure has dropped the word, so the
                  words go here for a reader with neither. */}
              {!loading && <span className="visually-hidden">{progressLabel(progress)}</span>}
              <span className="boss-band-count" aria-hidden="true">
                {loading ? <span className="skeleton sk-line" /> : bandCount(progress)}
              </span>
              {/* Never the bar alone. It is a second reading of the figure beside it, so a band
                  with nothing to run keeps the space and draws no track: an empty track is a bar
                  reading zero. The figures are withheld while loading for the same reason, the
                  skeleton's rows being invented (see SKELETON_BOSSES).

                  The floor rides on a class rather than on the width, so a band with nothing
                  cleared cannot pick it up. See bandFill. */}
              {!loading && progress.total ? (
                <span className="boss-progress-bar" aria-hidden="true">
                  <span
                    className={fill.nonzero ? "is-nonzero" : undefined}
                    style={{ width: fill.width }}
                  />
                </span>
              ) : (
                <span aria-hidden="true" />
              )}
            </span>
          );
        })}
    </span>
  );
}
