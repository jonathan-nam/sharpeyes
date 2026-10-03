"use client";

import { useId, type ReactNode } from "react";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { TILES_SHOWN } from "@/lib/carousel";
import { DOCK_LABELS, type DockName } from "@/lib/dock-collapse";
import { useDockOpen } from "@/lib/use-dock-open";

// The frame both upload docks sit in: a title bar that folds the dropzone away, and a list of
// captures under it that never folds.
//
// Captures stay because folding is about the box you drop ON, not about what came back. Hiding a
// read that is still in flight, or one that refused to save, would be hiding the answer to the
// upload you just made.

export function DockShell({
  name,
  open,
  onOpenChange,
  children,
  cards,
}: {
  name: DockName;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The folding half: the dropzone, and whatever has to be answered before it will accept a file.
  children: ReactNode;
  // The unfolding half.
  cards?: ReactNode;
}) {
  const panelId = useId();

  return (
    <section className="dock">
      <div className="dock-bar">
        <button
          type="button"
          className="dock-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
        >
          <span className="party-row-chevron dock-caret" aria-hidden="true" />
          {DOCK_LABELS[name]}
        </button>
      </div>

      {/* hidden, not unmounted: a fold must not throw away a file input mid-pick or a dropzone's
          drag state. */}
      <div id={panelId} hidden={!open}>
        {children}
      </div>

      {cards}
    </section>
  );
}

/**
 * The dock's shape while the route boundary is still waiting for the page's own JS.
 *
 * Unrendered, like the two docks themselves (#440). It stays for the day they go back on the page,
 * and a boundary that left it out then would drop ~200px of chrome in above the matrix the moment
 * the page mounted. Put it back only alongside the dock it stands for. On its own it flashes a
 * dropzone the page never draws, which is what both boundaries did for months after #440, and
 * what lib/dock-collapse.test.ts now refuses.
 *
 * Every height in here comes from the real classes rather than a measured number. That is the
 * lesson of the inventory window sitting 30px out of place (#77).
 */
export function DockSkeleton({ name, picker = false }: { name: DockName; picker?: boolean }) {
  const [open, setOpen] = useDockOpen(name);

  return (
    <DockShell name={name} open={open} onOpenChange={setOpen}>
      {picker && (
        <div className="planner-pick">
          <div className="carousel carousel-compact" aria-hidden="true">
            <button className="carousel-arrow" disabled tabIndex={-1}>
              &#8249;
            </button>
            <div className="carousel-track">
              {Array.from({ length: TILES_SHOWN }).map((_, i) => (
                <div className="char-tile is-compact is-skeleton" key={i}>
                  {/* Empty, not shimmered: see .sk-sprite, a filled square advertises a sprite
                      bigger than the one that replaces it. */}
                  <div className="tile-sprite" />
                  <div className="tile-plate">
                    <div className="tile-name">
                      <span className="skeleton sk-line" style={{ width: "70%" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="carousel-arrow" disabled tabIndex={-1}>
              &#8250;
            </button>
          </div>
        </div>
      )}

      <div className="dock-drop is-skeleton" aria-hidden="true">
        <span className="dock-drop-mark">
          <SharpEyesMark size={64} />
        </span>
        <span className="dock-drop-main">
          <span className="skeleton sk-line" style={{ width: "260px" }} />
        </span>
        <span className="dock-drop-sub">
          <span className="skeleton sk-line" style={{ width: "320px" }} />
        </span>
        {/* The eye chip is only on the inventory dock, and it is 39px of the dropzone's height. */}
        {!picker && (
          <span className="dock-eye">
            <span aria-hidden="true">&#128065;</span>
            <span className="skeleton sk-line" style={{ width: "130px" }} />
          </span>
        )}
      </div>
    </DockShell>
  );
}
