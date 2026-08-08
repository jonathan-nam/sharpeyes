"use client";

// Whether the run order runs to the clock, remembered across visits. Untimed is a whole different
// reading of the page (an order, not a schedule), so someone who plans that way would otherwise
// untick the box on every visit.

import { useSyncExternalStore } from "react";

export const SHOW_TIMES_KEY = "sharpeyes.run-order.show-times";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  // Reading the property itself throws when the browser blocks storage, so this is not the same
  // check as `typeof window`.
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Timed unless it was explicitly turned off, which is what the page did before it remembered. */
export function readShowTimes(store: StorageLike | null = browserStorage()): boolean {
  try {
    return store?.getItem(SHOW_TIMES_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeShowTimes(shown: boolean, store: StorageLike | null = browserStorage()): void {
  try {
    store?.setItem(SHOW_TIMES_KEY, shown ? "on" : "off");
  } catch {
    // A preference that cannot be saved is not worth failing the click over.
  }
}

// useSyncExternalStore, not useState, for the server snapshot: the page prerenders where the stored
// answer cannot be known. Hydration gets the timed page the server drew and re-renders from storage,
// instead of tripping a mismatch on the difference. Same reasoning as lib/use-dock-open.ts.
const listeners = new Set<() => void>();

// Cached because getSnapshot must return the SAME value until something changes.
let cached: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return (cached ??= readShowTimes());
}

function serverSnapshot(): boolean {
  return true;
}

export function useShowTimes(): [boolean, (shown: boolean) => void] {
  const shown = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  function setShown(next: boolean) {
    cached = next;
    writeShowTimes(next);
    for (const listener of listeners) listener();
  }

  return [shown, setShown];
}
