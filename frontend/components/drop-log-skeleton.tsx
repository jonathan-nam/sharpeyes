"use client";

import { SectionMark } from "@/components/section-mark";
import { dropSections } from "@/lib/drop-sections";
import { useAccountSettings } from "@/lib/use-account-settings";

// The Drop Log's loading state: the page's own chrome, not a line of text where a page will be.
//
// A one-line "Loading..." standing in for a ledger several screens tall is a hard swap however it
// is faded, because 95% of the viewport goes from empty to full in one step. Screenshotting the
// real navigation is what settled it: 1.3s of an all-but-empty screen, then everything at once.
//
// Built from the real classes rather than hand-measured shapes, for the reason app/bosses/loading.tsx
// gives: a skeleton that restates the metrics by hand is what put the inventory window 30px out of
// place (#77). The tabs and the form ARE the real markup, disabled. Only the figures are shimmer,
// because those are the one thing that must never be guessed at.

// Enough rows to fill the fold at 900px without pretending to know how many there are. The list is
// the one part whose length is genuinely unknown, so it fades rather than claiming a count.
const ROWS = 4;

function Row() {
  return (
    <li className="droplog-row">
      <div className="droplog-row-head">
        <span className="loot-icon skeleton" />
        <span className="droplog-title">
          {/* No chevron held beside it. It hangs off the name of a row that folds, so it takes no
              column of its own and there is nothing here to reserve. */}
          <span className="droplog-name-line">
            <span className="loot-name">
              <span className="skeleton sk-line" style={{ width: "132px" }} />
            </span>
          </span>
          <span className="loot-meta">
            <span className="skeleton sk-line" style={{ width: "190px" }} />
          </span>
        </span>
        <span className="droplog-amounts">
          <span className="droplog-take">
            <span className="skeleton sk-line" style={{ width: "104px" }} />
          </span>
          <span className="loot-share-nets">
            <span className="skeleton sk-line" style={{ width: "88px" }} />
          </span>
        </span>
      </div>
    </li>
  );
}

export function DropLogSkeleton() {
  // Read here rather than passed in, because app/bosses/drops/loading.tsx has nothing to pass: the
  // route boundary and the page have to draw the same strip or a cold route flashes a shape the
  // loaded page does not have. The store is warm on any navigation from inside the app.
  const sections = dropSections(useAccountSettings()?.trades);

  return (
    <div role="status" aria-label="Loading your drops">
      {/* The real strip, drawn on the same condition as the page's, so a Heroic world holds no
          height for tabs it will not get. */}
      {sections.length > 1 && (
        <div className="basis-row droplog-sections" aria-hidden="true">
          {sections.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className={i === 0 ? "basis-tab active" : "basis-tab"}
              disabled
            >
              {/* No art: the tables it comes from are what is still loading. The box is held. */}
              <SectionMark section={s.key} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* The real Add Drop panel, down to the disabled controls and their labels, so its height is
          its own and not a number copied out of it. The labels are half of that height now. */}
      <section className="loot-pool add-section" aria-hidden="true">
        <h2 className="loot-pool-title">Add Drop</h2>
        <form className="add-card">
          <div className="add-fields">
            <label className="add-field">
              <span>Boss</span>
              <select className="split-input" disabled aria-hidden="true">
                <option>pick a boss</option>
              </select>
            </label>
            <label className="add-field is-drop">
              <span>Drop</span>
              <button type="button" className="split-input drop-select" disabled>
                <span className="drop-select-label is-empty">Select a drop...</span>
                <span className="drop-select-arrow" aria-hidden="true" />
              </button>
            </label>
            <button type="submit" className="party-save add-plus" disabled>
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </form>
      </section>

      {/* No stat row. It held three tiles, then one once the money went to the Settled View, and
          none once the count followed it. A placeholder for a row the page does not draw is the
          height jump this skeleton exists to prevent, pointing the other way. */}

      {/* The Group picker. Real markup again, because measuring its 57px by hand and pasting the
          number in is how the rows below end up landing somewhere else. */}
      <div className="party-toolbar" aria-hidden="true">
        <label className="droplog-filter">
          <span className="stat-label">Group</span>
          <select className="split-input" disabled>
            <option>Month</option>
          </select>
        </label>
      </div>

      <section className="party-group" aria-hidden="true">
        <header className="droplog-group-head">
          <h2 className="party-group-name">
            <span className="skeleton sk-line" style={{ width: "108px", height: "14px" }} />
          </h2>
          <span className="droplog-group-total">
            <span className="skeleton sk-line" style={{ width: "120px" }} />
          </span>
        </header>
        <ul className="droplog-list">
          {Array.from({ length: ROWS }).map((_, i) => (
            <Row key={i} />
          ))}
        </ul>
      </section>
    </div>
  );
}
