import { useEffect, useState } from "react";

// Decoded images, held so an <img> asking for the same URL paints from memory in the same frame
// (see lib/seat-sprites.ts for why the element is kept). A URL that failed is here too: it is as
// ready as it will get.
const settled = new Map<string, HTMLImageElement>();

/**
 * True once `url` is decoded, or failed, or there is no image to wait for.
 *
 * Answered synchronously for a URL already settled, so coming back to a page costs no blank frame.
 */
export function useImageReady(url: string | null): boolean {
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!url || settled.has(url)) return;
    let live = true;
    const img = new Image();
    img.src = url;
    void img
      .decode()
      .catch(() => {})
      .finally(() => {
        settled.set(url, img);
        if (live) rerender((n) => n + 1);
      });
    return () => {
      live = false;
    };
  }, [url]);

  return !url || settled.has(url);
}

/** False until `ms` have passed since mount. */
export function useDeadline(ms: number): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return passed;
}
