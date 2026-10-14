"use client";

import { useEffect, useState } from "react";
import { CountPopup } from "@/components/count-popup";
import { apiAssetUrl } from "@/lib/api";
import type { TokenCatalogItem } from "@/types/token-catalog";

// The count, drawn from the client's own digit sprites rather than set in a web font.
//
// The in-game count is an 11px bitmap face with a hard black outline, and no web font is that
// font, every approximation of it sits directly beneath a pixel-exact icon and gives itself
// away. We already own the real glyphs: they are the templates the parser reads counts WITH
// (vision/app/cv/templates/digit_*.png), cut from the client, and the backend now serves them.
// So the number below each icon is the same picture the game would draw. `1` is 5px wide and the
// rest are 8px, which is the font's own proportional spacing. Laying them out in a row
// reproduces it for free.
function Count({ value }: { value: number }) {
  return (
    <span className="ms-qty" aria-label={String(value)}>
      {String(value)
        .split("")
        .map((d, i) => (
          <img key={i} src={apiAssetUrl(`/digit-icons/${d}.png`)} alt="" aria-hidden="true" />
        ))}
    </span>
  );
}

// The real inventory is 16 wide, the same lattice the parser locks onto
// (vision/app/cv/grid.py), and the same 128 the client's own "SLOT 112 / 128" readout counts
// against. The preview shows the same 16 columns over fewer rows, so a screenshot's items land
// in the same shape they will occupy once they are saved.
export const COLS = 16;

export type SlotItem = {
  id: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  note?: string;
  itemGroup?: string | null;
  // How this count differs from what is already stored. Only the preview sets it: it is the
  // whole point of showing a parse before writing it. `null` = we hold none of this yet ("new");
  // `undefined` = we cannot say, so say nothing.
  delta?: number | null;
};

function deltaLabel(delta: number | null | undefined): string | null {
  if (delta === null) return "new";
  if (delta === undefined || delta === 0) return null;
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function SlotGrid({
  items,
  rows,
  onAdjust,
  onCommit,
  addable,
  onAdd,
}: {
  items: SlotItem[];
  rows: number;
  // When set, clicking a filled slot opens a popup to edit its count. Left unset by the capture
  // preview, whose slots are a parse to look at rather than holdings to change.
  //
  // Clicking used to put the item's name in the search bar instead. One click, one thing: a
  // stepper that shared the slot with that meant two targets in one 42px square, and a click a few
  // pixels off changed a count when you meant to look the item up.
  onAdjust?: (id: string, next: number) => void;
  // The total to keep once the pressing stops. Separate from onAdjust, which fires on every step
  // and writes nothing.
  onCommit?: (id: string, final: number) => void;
  // A trailing + slot offering the items this character holds none of. Only the LAST grid on a
  // panel gets one, so there is one + on the screen and not one per section.
  addable?: TokenCatalogItem[];
  onAdd?: (tokenCatalogId: string) => void;
}) {
  const wantsAdd = Boolean(addable && addable.length > 0 && onAdd);
  // The + sits at the item's own index, immediately after the last one drawn, rather than after
  // the empty cells that pad the grid out: at the end of the padding it was nowhere near the item
  // it follows. A grid the items fill exactly gets one more row to put it in.
  const padded = COLS * rows;
  const slots = wantsAdd && items.length >= padded ? padded + COLS : padded;
  // The item being edited, with its slot in viewport coordinates: the popup is fixed, so it needs
  // an anchor rather than a positioned parent. See CountPopup.
  const [editing, setEditing] = useState<{ id: string; anchor: DOMRect } | null>(null);

  // A fixed popup is anchored to where the slot WAS. Scrolling moves the slot and not the popup,
  // so it is dismissed rather than left pointing at the wrong item.
  useEffect(() => {
    if (!editing) return;
    const drop = () => setEditing(null);
    window.addEventListener("scroll", drop, true);
    return () => window.removeEventListener("scroll", drop, true);
  }, [editing]);
  /* Everything above draws what somebody HOLDS, so an item at zero has no slot to hover and no
     stepper to raise. This is the one case hovering cannot cover.

     A native select rather than a popover of our own: the list is the whole catalog minus what is
     held, and a select gets keyboard, type-ahead and a scrolling list for free. It covers the slot
     invisibly, so the + underneath is what you see and the browser's own dropdown is what you get. */
  function addSlot(key: number) {
    return (
      <div key={key} className="ms-slot ms-add" title="Add Item">
        <select
          className="ms-add-select"
          aria-label="Add an item"
          value=""
          onChange={(e) => e.target.value && onAdd!(e.target.value)}
        >
          {/* Selected and empty, so the box reads as unanswered and picking the same item twice in
              a row still fires a change. */}
          <option value="">Add Item</option>
          {addable!.map((option) => (
            <option key={option.tokenCatalogId} value={option.tokenCatalogId}>
              {option.name}
            </option>
          ))}
        </select>
        <span className="ms-add-mark" aria-hidden="true">
          +
        </span>
      </div>
    );
  }

  return (
    <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
      {Array.from({ length: slots }, (_, i) => {
        const item = items[i];
        if (!item)
          return wantsAdd && i === items.length ? addSlot(i) : <div key={i} className="ms-slot" />;

        const badge = deltaLabel(item.delta);
        // The tooltip is the item name and nothing else. The count is drawn under the icon
        // already, and the delta/redemption detail lives in the search view a click away.
        const contents = (
          <>
            {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
            <Count value={item.quantity} />
            {badge && (
              <span
                className={`ms-delta${item.delta === null ? " new" : item.delta! > 0 ? " up" : " down"}`}
              >
                {badge}
              </span>
            )}
          </>
        );

        const editable = Boolean(onAdjust && onCommit);
        if (!editable) {
          return (
            <div key={i} className="ms-slot filled" title={item.name}>
              {contents}
            </div>
          );
        }

        return (
          <div key={i} className="ms-slot-hold">
            <button
              type="button"
              className="ms-slot filled clickable"
              title={item.name}
              aria-haspopup="dialog"
              aria-expanded={editing?.id === item.id}
              onClick={(e) => {
                // Measured HERE, not inside the updater below. React nulls currentTarget once the
                // handler returns, and a functional updater runs later, so reading the rect in
                // there threw on the very first click of any item.
                const anchor = e.currentTarget.getBoundingClientRect();
                setEditing((open) => (open?.id === item.id ? null : { id: item.id, anchor }));
              }}
            >
              {contents}
            </button>
            {editing?.id === item.id && (
              <CountPopup
                name={item.name}
                value={item.quantity}
                anchor={editing.anchor}
                onChange={(next) => onAdjust!(item.id, next)}
                onCommit={(final) => onCommit!(item.id, final)}
                onClose={() => setEditing(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
