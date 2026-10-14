// View state kept in the query string, so a reload lands back on the same tab.
//
// Read through useQueryString rather than useSearchParams, which would need a Suspense boundary
// around the whole page to prerender. Written with replaceState, so a tab click is not a history
// entry for Back to step through.

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/** The page's query string. Empty during the prerender, which has no URL. */
export function useQueryString(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => "",
  );
}

/** One param, if it is one of `allowed`. Anything else reads as absent. */
export function queryParam<T extends string>(
  search: string,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = new URLSearchParams(search).get(name);
  return allowed.find((a) => a === value);
}

/** The current URL with `params` set and the rest kept. Null removes one. */
export function withQuery(href: string, params: Record<string, string | null>): string {
  const url = new URL(href);
  for (const [name, value] of Object.entries(params)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  return url.pathname + url.search + url.hash;
}

export function replaceQuery(params: Record<string, string | null>): void {
  window.history.replaceState(null, "", withQuery(window.location.href, params));
}
