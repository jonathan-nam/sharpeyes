"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// The horizontal tile strip shared by the inventory carousel and the boss-clears picker. Only the
// scrolling belongs here; what a tile is and what selecting one does stay with each caller.
export function useCarousel(deps: unknown[]) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  // Reordering swaps two tiles, which makes scroll-snap re-snap and jumps the view a tile over
  // (move a character and the strip slides from showing 1-4 to 2-5). Pin the scroll across the
  // reorder: capture it at the click, restore it once the new order has painted.
  const scrollToKeep = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (el && scrollToKeep.current !== null) {
      el.scrollLeft = scrollToKeep.current;
      scrollToKeep.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Arrows are disabled at the ends rather than hidden, so the strip doesn't
  // change width as you page through it.
  function syncArrows() {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }

  useEffect(() => {
    syncArrows();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncArrows, { passive: true });
    window.addEventListener("resize", syncArrows);
    return () => {
      el.removeEventListener("scroll", syncArrows);
      window.removeEventListener("resize", syncArrows);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  function page(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    // Page by a whole number of tiles so the strip lands on a tile edge, never mid-tile.
    // Measured from the first tile so it tracks the real tile width, with a fallback for
    // before the first tile has mounted. At least one tile per page on a narrow window.
    const tile = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 16;
    const stride = tile ? tile.offsetWidth + gap : 206;
    // Add a gap back before dividing: the visible width holds the gaps BETWEEN its tiles, one
    // short of a whole number of strides. Dividing without it pages a strip showing exactly six
    // by five, which is what a tile sized as a share of the track always is.
    const perPage = Math.max(1, Math.round((el.clientWidth + gap) / stride));
    el.scrollBy({ left: direction * perPage * stride, behavior: "smooth" });
  }

  function pinScroll() {
    scrollToKeep.current = trackRef.current?.scrollLeft ?? null;
  }

  return { trackRef, atStart, atEnd, page, pinScroll };
}
