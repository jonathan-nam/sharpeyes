"use client";

import { apiAssetUrl } from "@/lib/api";

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
  onSelectItem,
}: {
  items: SlotItem[];
  rows: number;
  // When set, each filled slot is a button that hands its item name back, so the page can
  // search every character for it. Left unset by the capture preview, whose slots are a parse
  // to look at, not holdings to search.
  onSelectItem?: (name: string) => void;
}) {
  const slots = COLS * rows;
  return (
    // max-content, not 1fr: the tracks must resolve to the slot's own 42px. Under 1fr a container
    // wider than the grid (the capture dock, unlike .ms-window) spreads the columns onto
    // fractional offsets, and the icon's translate(-50%, -50%) then lands on a half pixel, where
    // image-rendering: pixelated smears exactly as described on .ms-slot > img.
    <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${COLS}, max-content)` }}>
      {Array.from({ length: slots }, (_, i) => {
        const item = items[i];
        if (!item) return <div key={i} className="ms-slot" />;

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

        if (onSelectItem) {
          return (
            <button
              key={i}
              type="button"
              className="ms-slot filled clickable"
              title={item.name}
              onClick={() => onSelectItem(item.name)}
            >
              {contents}
            </button>
          );
        }

        return (
          <div key={i} className="ms-slot filled" title={item.name}>
            {contents}
          </div>
        );
      })}
    </div>
  );
}
