"use client";

import { useAuth } from "@/lib/use-auth";
import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import type { Settings } from "@/types/settings";

// The account's settings, shared by every component that asks for them.
//
// A module store rather than the SWR cache in lib/cache.ts, because this one has to PUSH: the
// world toggle sits in the header and changes what every mounted page is showing, so a cache read
// only on mount would leave the menu offering a tool the account just toggled away from.

export const SETTINGS_KEY = "/api/settings";

let current: Settings | undefined;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Called by whoever learns the answer: the fetch below, or the toggle after it writes. */
export function setAccountSettings(settings: Settings): void {
  // Every field, or the store goes quiet on a change nobody else can see: picking a main moves
  // only mainCharacterId, and a comparison blind to it would leave the header avatar as it was.
  if (
    current?.worldType === settings.worldType &&
    current?.trades === settings.trades &&
    current?.otherWorldCharacters === settings.otherWorldCharacters &&
    current?.mainCharacterId === settings.mainCharacterId &&
    current?.mainCharacterSprite === settings.mainCharacterSprite
  ) {
    return;
  }
  current = settings;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read the settings once, however many callers ask at once.
 *
 * The same guard as lib/session-token.ts, and for the same reason: `current` only turns a caller
 * away once the read has ANSWERED, so every component mounting inside that window opened its own.
 * Nine call sites feed this hook, and prod logged five `/api/settings` reads for a single load of
 * /bosses/drops, the first taking 816ms and the other four riding inside it.
 *
 * The fetch is passed in rather than called here so the guard can be tested without a DOM, the
 * same trick apiFetch plays with getToken.
 */
export function loadAccountSettings(fetchSettings: () => Promise<Settings>): Promise<void> {
  if (current !== undefined) return Promise.resolve();
  inFlight ??= fetchSettings()
    .then(setAccountSettings)
    // Swallowed on purpose. This decides what a menu lists, so a failed read leaves the menu as it
    // was rather than putting an error on screen for something the user did not ask for.
    .catch(() => {})
    .finally(() => {
      // Cleared so a failed read is retried by the next component to mount, rather than never.
      inFlight = null;
    });
  return inFlight;
}

/**
 * The account's settings, or undefined until they are known.
 *
 * Undefined is not a third state to render. It means "not answered yet", and every caller has to
 * decide what to do in that moment rather than assume an answer.
 */
export function useAccountSettings(): Settings | undefined {
  const { getToken, isSignedIn } = useAuth();
  const settings = useSyncExternalStore(
    subscribe,
    () => current,
    () => undefined,
  );

  useEffect(() => {
    if (!isSignedIn) return;
    void loadAccountSettings(() => apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return settings;
}
