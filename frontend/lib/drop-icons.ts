import { useEffect } from "react";
import { apiAssetUrl } from "./api";
import type { DropTables } from "@/types/drop";

/** Every distinct drop icon in the tables. A coupon on four bosses' tables is one URL. */
export function dropIconUrls(tables: DropTables): string[] {
  const urls = new Set<string>();
  for (const table of Object.values(tables)) {
    for (const drop of table) {
      if (drop.iconUrl) urls.add(drop.iconUrl);
    }
  }
  return [...urls];
}

/** Warmed already. A page that re-renders on every keystroke must not re-request the catalog. */
const warmed = new Set<string>();

/**
 * Start the drop icons downloading while the tables are being read.
 *
 * Nothing asks for one until a picker is opened, so the first open of a row's panel would otherwise
 * paint blank frames for as long as the download takes. The page is holding the URLs already, from
 * /api/bosses/drops, so it can start that click early. Bounded by the catalog, a few dozen icons of 46px.
 *
 * `new Image()` and not the `preload` of lib/preload-boss-art.ts, for the reason useSeatSprites
 * gives: a `<link rel=preload>` for art the page has not drawn yet is warned about in the console
 * once a few seconds pass, and the click it is waiting for may never come.
 *
 * Nothing is held afterwards, which is where this differs from the seat sprites. These come from
 * our own backend, which sends `max-age=86400` on /drop-icons (see Routing.kt), so the HTTP cache
 * keeps them and the elements have nothing left to do.
 */
export function useDropIcons(tables: DropTables): void {
  useEffect(() => {
    for (const url of dropIconUrls(tables)) {
      if (warmed.has(url)) continue;
      warmed.add(url);
      new Image().src = apiAssetUrl(url);
    }
  }, [tables]);
}
