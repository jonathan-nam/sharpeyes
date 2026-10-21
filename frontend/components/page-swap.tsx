"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Holds the wait on screen until what replaces it is visible.
 *
 * The two halves of a load used to hand over in one frame with nothing in between: the "Loading..."
 * was unmounted and the content began its fade at opacity 0, so a page read as three beats, the
 * middle one blank. Traced on the production build, the blank frame was the full height of the
 * loaded page with only the title on it.
 *
 * So they overlap. The placeholder is kept mounted for the length of the fade and taken out of
 * flow, the content fades up underneath it, and only then is it dropped.
 *
 * Once settled its wrappers are `display: contents`, so steady-state layout is exactly what it
 * would be without them. They are never taken OUT: returning bare children when the fade ended
 * changed the tree's shape, React remounted the whole page, and whatever was pressed or typed in
 * the first 280ms (an armed confirm, a half-filled box) was lost.
 */

// The overlap. Must match .page-swap-in in globals.css: the placeholder is unmounted from here, so
// a shorter timer cuts the fade off part-way through it. Pinned by section-menu-css.test.ts.
export const CROSSFADE_MS = 280;

export function PageSwap({
  waiting,
  placeholder,
  children,
  shaped = false,
}: {
  waiting: boolean;
  /** What stands in while the page waits, and fades out over what arrives. */
  placeholder: ReactNode;
  children: ReactNode;
  /**
   * The placeholder is the page's own shape, not a line of text, so it is drawn from the frame the
   * route commits instead of waiting out the delay. See PAGE_WAITING_SHAPED in route-loading.tsx.
   */
  shaped?: boolean;
}) {
  const [lingering, setLingering] = useState(false);
  const [wasWaiting, setWasWaiting] = useState(waiting);
  const leaving = useRef<HTMLDivElement>(null);

  // Adjusted during render rather than in an effect. React supports this for deriving a transition
  // from a prop change, and it is the difference between the placeholder lingering from the very
  // frame the content mounts and lingering from the frame after it. That one frame is the blank
  // one this component exists to remove.
  if (wasWaiting !== waiting) {
    setWasWaiting(waiting);
    // A shaped placeholder is REPLACED, not dissolved, so there is nothing to hold it on for.
    // Crossfading it means two different layouts on screen at once, and they do not line up: the
    // loaded Add Drop row carries a character picker and the toolbar a Character filter, neither
    // of which a skeleton can know about. Measured at the midpoint of the fade, both rows were
    // drawn over each other, offset, for the whole 280ms. That doubling is what reads as the page
    // flickering away and then filling back in.
    //
    // Nothing is blank in its place: the placeholder goes and the content arrives in the same
    // commit. The blank beat this component exists to remove came from fading content UP from zero
    // once the placeholder had already gone, which is not what happens here.
    if (!waiting) setLingering(!shaped);
  }

  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [lingering]);

  /*
   * The fade OUT is script's, because only script can read where the fade IN got to.
   *
   * A CSS animation cannot: it restarts from the base opacity, which is 1. Measured in Chromium
   * against the real rules, a wait ending at 60ms took the placeholder from 0.00 to 1.00 in one
   * frame, and one ending at 200ms from 0.59 to 1.00. The first is the whole flicker on Drop Log:
   * inside the 150ms delay nothing has been drawn, and the way out drew all of it anyway. It was
   * only ever noticed there because every other page stands a line of text in the gap and that
   * page stands a full-height skeleton.
   *
   * .page-waiting stays on the element, so this reads the opacity actually on screen and the fade
   * in carries on undisturbed until this takes over.
   */
  useEffect(() => {
    const el = leaving.current;
    if (!lingering || !el || typeof el.animate !== "function") return;
    const fade = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], {
      duration: CROSSFADE_MS,
      easing: "ease-out",
      // Or the placeholder snaps back to what the fade in left it at, for any frame between this
      // ending and the timer above unmounting it.
      fill: "forwards",
    });
    return () => fade.cancel();
  }, [lingering]);

  const holding = waiting || lingering;

  /*
   * A shaped placeholder is drawn at once, at full strength, and bare.
   *
   * It must not fade IN. On a client navigation the router replaces the outgoing page with this, so
   * a placeholder starting at zero means the page you came from is swapped for a near-empty screen
   * that then rises: measured on a menu click to Drop Log, 747px of page, then the skeleton at
   * opacity 0.00 rising over 200ms. That is the flicker on a navigation, and it is invisible on a
   * refresh, where there is no outgoing page for it to be compared against. Which is exactly the
   * difference that was reported.
   *
   * No wrapper either. Nothing ever overlaps here (see setLingering above), so it needs no
   * positioning context, and this is then the same markup the route boundary renders: handing over
   * from loading.tsx to the page changes nothing on screen.
   */
  if (shaped) return waiting ? <>{placeholder}</> : <>{children}</>;

  // Settled, the same two elements stay and merely stop being boxes. See the comment at the top.
  return (
    <div className={holding ? "page-swap" : "page-swap-done"}>
      {holding && (
        // While waiting it is the placeholder, and wears the delay that decides whether it is drawn
        // at all: a load that finishes inside 150ms should never show one. That class is on this
        // element rather than on the page's <main> because the router unmounts the outgoing page the
        // moment the route commits, so hiding <main> hid everything, title included.
        //
        // On the way out it goes out of flow, not stacked in a grid: a grid container does not
        // collapse margins with its children, which added 20px above the first panel for the length
        // of the fade and then took it away again. That is the shift this exists to remove. It keeps
        // .page-waiting through that, so the delay is not undone on the way out: see the fade above.
        <div
          ref={leaving}
          className={waiting ? "page-waiting" : "page-waiting page-swap-out"}
          aria-hidden={!waiting}
        >
          {placeholder}
        </div>
      )}
      {!waiting && <div className={lingering ? "page-swap-in" : "page-swap-done"}>{children}</div>}
    </div>
  );
}
