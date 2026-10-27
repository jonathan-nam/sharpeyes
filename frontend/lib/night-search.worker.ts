// Run Order's search, off the main thread. See use-night-search.ts.

import { type NightSearch, searchNight } from "@/lib/night-search";

self.onmessage = (event: MessageEvent<{ key: string; input: NightSearch }>) => {
  const { key, input } = event.data;
  self.postMessage({ key, result: searchNight(input) });
};
