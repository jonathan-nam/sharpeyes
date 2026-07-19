"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, SlotGrid, type SlotItem } from "@/components/slot-grid";

// The client's tab row, in its order and with its spelling ("Etc." and "Set-up" carry their
// punctuation in-game). Everything we track is a consumable, so it all lives in Use.
const CATEGORIES = ["Equip", "Use", "Etc.", "Set-up", "Cash", "Dec."] as const;
type Category = (typeof CATEGORIES)[number];

// The order the sections appear in. An item whose group we do not recognise falls to the end
// under "Other" rather than vanishing: an item you cannot see is an item you will not notice is
// missing, and not losing track of things is the entire job.
const SECTION_ORDER = ["Eternal Pieces", "Symbols", "Consumables"] as const;
const OTHER = "Other";

export type InventoryItem = SlotItem & { itemGroup?: string | null };

// The content area the panel shows while `loading`, shaped like a loaded inventory: stacked
// section blocks (a header, then a rounded grid of the 16-column, 42px lattice), spaced apart the
// same way the real sections are, so the real content replaces it without the layout jumping. Rows
// per section evoke the real SECTION_ORDER (Eternal Pieces, Symbols, Consumables) rather than one
// solid slab. Styles live in globals.css (.ms-grid-skeleton / .sk-slot / .sk-inv-line).
const SKELETON_SECTION_ROWS = [1, 1, 1];

function InventoryGridSkeleton() {
  return (
    <div aria-hidden="true">
      {SKELETON_SECTION_ROWS.map((rows, s) => (
        <section className="ms-section" key={s}>
          <header className="ms-section-head">
            <span className="sk-inv-line" style={{ width: 96 }} />
            <span className="sk-inv-line ms-section-count" style={{ width: 34 }} />
          </header>
          <div className="ms-grid-skeleton">
            {Array.from({ length: COLS * rows }).map((_, i) => (
              <span key={i} className="sk-slot" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function InventoryPanel({
  title,
  items,
  emptyHint,
  loading = false,
  onSelectItem,
  focusSignal = 0,
  onLeaveUp,
}: {
  // The character's name, and nothing else. The level used to hang off it as "· Lv.287", which
  // repeated what the tile directly above already says and gave the window's title bar a second
  // job. The title bar names the window.
  title: string;
  items: InventoryItem[];
  emptyHint?: string;
  // The window frame stays mounted while the tokens are still in flight; this fills its content
  // area with a placeholder slot grid rather than an empty box, so the real items crossfade in
  // where the grid was instead of the panel appearing at once. Used for a character whose tokens
  // are not in the browser yet (e.g. one added mid-session); the initial page load uses the
  // full-page skeleton instead.
  loading?: boolean;
  // Clicking an item searches every character for it (see the page).
  onSelectItem?: (name: string) => void;
  // Bumped by the page when another region hands focus here. See the inventory page.
  focusSignal?: number;
  // Arrow up out of the panel, back to the carousel.
  onLeaveUp?: () => void;
}) {
  const [category, setCategory] = useState<Category>("Use");
  const [focused, setFocused] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSignal === 0) return;
    panelRef.current?.focus();
  }, [focusSignal]);

  // Left/right cycle categories, up leaves for the carousel.
  //
  // This used to be Tab, in-game style, and that was a focus trap: the listener sat on the panel
  // in the bubble phase, so it swallowed Tab from every descendant too. The category buttons and
  // the slot buttons became unreachable, and the Escape hatch called blur() on the panel, which
  // is a no-op when a child is what actually holds focus. Tab is the browser's, not ours.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // The focused element, not the panel: from a slot button, blurring the panel does nothing.
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    // Only from the panel itself or the tab row. Inside a slot the arrows belong to whatever the
    // browser does with them, and stealing them there would strand you in the grid.
    const target = e.target as HTMLElement;
    if (target !== panelRef.current && target.getAttribute("role") !== "tab") return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      onLeaveUp?.();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setCategory((current) => {
      const i = CATEGORIES.indexOf(current);
      const step = e.key === "ArrowLeft" ? -1 : 1;
      const next = (i + step + CATEGORIES.length) % CATEGORIES.length;
      return CATEGORIES[next] ?? current;
    });
  }

  const shown = category === "Use" ? items : [];

  const known = (g: string | null | undefined) =>
    !!g && (SECTION_ORDER as readonly string[]).includes(g);

  const sections = [...SECTION_ORDER, OTHER]
    .map((name) => ({
      name,
      items: shown.filter((i) => (name === OTHER ? !known(i.itemGroup) : i.itemGroup === name)),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <div
      ref={panelRef}
      className={`ms-window${focused ? " focused" : ""}`}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
    >
      <div className="ms-titlebar">
        <span className="ms-title">INVENTORY</span>
        <span className="ms-title-sub">{title}</span>
        {/* The keyboard hint belongs next to the window controls, where you look when you are
            thinking about the window. It used to sit in a footer beneath the grid, alongside an
            "N items tracked" readout that told you a number you can see by looking, so the
            footer is gone and the hint has moved up. */}
        <span className="ms-title-hint">{focused ? "← → · ↑ · Esc" : "Click to focus"}</span>
        <span className="ms-window-buttons" aria-hidden="true">
          <i>&#8211;</i>
          <i>+</i>
          <i>&#215;</i>
        </span>
      </div>

      <div className="ms-tabs" role="tablist">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={c === category}
            className={`ms-tab${c === category ? " active" : ""}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sections, not the bag.
       *
       * This used to render all 128 slots, faithfully to the client. Faithful, and useless: a
       * grid that is nine-tenths empty makes you hunt for the twenty things you actually track,
       * and it gives the six boss tokens (the point of the whole app) exactly the same weight
       * as a stack of potions. The game has to draw empty slots because you can put things in
       * them. We never can; we only ever show what you already HAVE.
       *
       * So: one block per group, sized to its contents, in a fixed order. The slot lattice stays
       * (same 16 columns, same 46px sprites drawn 1:1) because that is what makes this read
       * as an inventory rather than a spreadsheet. */}
      {loading ? (
        <InventoryGridSkeleton />
      ) : sections.length > 0 ? (
        sections.map((section) => (
          <section key={section.name} className="ms-section">
            <header className="ms-section-head">
              <h3>{section.name}</h3>
              <span className="ms-section-count">
                {section.items.length} {section.items.length === 1 ? "item" : "items"}
              </span>
            </header>
            <SlotGrid
              items={section.items}
              rows={Math.max(1, Math.ceil(section.items.length / COLS))}
              onSelectItem={onSelectItem}
            />
          </section>
        ))
      ) : (
        <div className="ms-empty">
          {category === "Use" ? (emptyHint ?? "Nothing here yet.") : `No ${category} items.`}
        </div>
      )}
    </div>
  );
}
