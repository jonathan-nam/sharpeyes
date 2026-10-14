"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, SlotGrid, type SlotItem } from "@/components/slot-grid";
import type { TokenCatalogItem } from "@/types/token-catalog";

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
  onAdjust,
  onCommit,
  addable,
  onAdd,
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
  // Hovering an item raises a stepper above it. Absent on a read-only panel, which is every use of
  // this that is not somebody's own live inventory.
  onAdjust?: (id: string, next: number) => void;
  onCommit?: (id: string, final: number) => void;
  // Items this character holds none of. They have no slot to hover, so the + at the end of the
  // grid is the only way in for them.
  addable?: TokenCatalogItem[];
  onAdd?: (tokenCatalogId: string) => void;
}) {
  const [category, setCategory] = useState<Category>("Use");
  const [focused, setFocused] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tab cycles tabs, as it does in-game. Only while the panel holds focus, so Tab keeps meaning
  // "next element" everywhere else on the page, and Escape hands focus back, so a keyboard
  // user is never stuck inside the panel.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        panelRef.current?.blur();
        return;
      }
      if (e.key !== "Tab") return;
      e.preventDefault();
      setCategory((current) => {
        const i = CATEGORIES.indexOf(current);
        const step = e.shiftKey ? -1 : 1;
        const next = (i + step + CATEGORIES.length) % CATEGORIES.length;
        return CATEGORIES[next] ?? current;
      });
    }

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

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
    >
      <div className="ms-titlebar">
        <span className="ms-title">INVENTORY</span>
        <span className="ms-title-sub">{title}</span>
        {/* The keyboard hint belongs next to the window controls, where you look when you are
            thinking about the window. It used to sit in a footer beneath the grid, alongside an
            "N items tracked" readout that told you a number you can see by looking, so the
            footer is gone and the hint has moved up. */}
        <span className="ms-title-hint">{focused ? "Tab · Esc" : "Click to focus"}</span>
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
        sections.map((section, s) => (
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
              onAdjust={onAdjust}
              onCommit={onCommit}
              // The LAST section only, so there is one + on the screen rather than one per
              // section, and it sits after the last item drawn.
              addable={s === sections.length - 1 ? addable : undefined}
              onAdd={s === sections.length - 1 ? onAdd : undefined}
            />
          </section>
        ))
      ) : category === "Use" && addable && addable.length > 0 && onAdd ? (
        // Nothing held yet, which is the case with no slot to hover at all and so the one that
        // most needs a way in. The grid is drawn holding only the +.
        <section className="ms-section">
          <SlotGrid items={[]} rows={1} addable={addable} onAdd={onAdd} />
        </section>
      ) : (
        <div className="ms-empty">
          {category === "Use" ? (emptyHint ?? "No items yet.") : `No ${category} items.`}
        </div>
      )}
    </div>
  );
}
