/** Where a floating tip goes, in viewport pixels, for `position: fixed`. */
export type TipPlacement = { top: number; left: number; below: boolean };

type Box = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };

/** Space between the anchor and the tip. */
const GAP = 6;
/** The closest a tip comes to the viewport's edge. */
const MARGIN = 8;

/**
 * Above the anchor and centred on it, below when above does not fit, and slid sideways to stay on
 * screen. When neither side fits, the roomier one: a clipped tip is still more readable than one
 * flipped into less space.
 */
export function placeTip(
  anchor: Box,
  tip: Size,
  viewport: Size,
  prefer: "above" | "below" = "above",
): TipPlacement {
  const aboveTop = anchor.top - GAP - tip.height;
  const belowTop = anchor.top + anchor.height + GAP;
  const fitsAbove = aboveTop >= MARGIN;
  const fitsBelow = belowTop + tip.height <= viewport.height - MARGIN;

  let below: boolean;
  if (prefer === "above")
    below = !fitsAbove && (fitsBelow || viewport.height - belowTop > anchor.top);
  else below = fitsBelow || (!fitsAbove && viewport.height - belowTop > anchor.top);

  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(MARGIN, Math.min(centred, viewport.width - MARGIN - tip.width));

  return { top: below ? belowTop : aboveTop, left, below };
}
