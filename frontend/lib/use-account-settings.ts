"use client";

import { useAuth } from "@/lib/use-auth";
import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import type { Settings } from "@/types/settings";
import type { WorldType } from "@/lib/world";

// The account's settings, shared by every component that asks for them.
//
// A module store rather than the SWR cache in lib/cache.ts, because this one has to PUSH: the
// world toggle changes what every mounted component is showing, the header's menu included, so a cache read
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
    current?.mainCharacterSprite === settings.mainCharacterSprite &&
    current?.mainCharacterName === settings.mainCharacterName
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

type GetToken = () => Promise<string | null>;

/**
 * The account's writes, each answered with the whole settings object and put in the store, so every
 * reader redraws off the server's reply rather than off what the caller assumed it did.
 */
export async function saveWorld(worldType: WorldType, getToken: GetToken): Promise<Settings> {
  const saved = await apiFetch<Settings>(
    SETTINGS_KEY,
    { method: "PUT", body: JSON.stringify({ worldType }) },
    getToken,
  );
  setAccountSettings(saved);
  return saved;
}

export async function saveMainCharacter(
  characterId: string,
  getToken: GetToken,
): Promise<Settings> {
  const saved = await apiFetch<Settings>(
    `${SETTINGS_KEY}/main-character`,
    { method: "PUT", body: JSON.stringify({ characterId }) },
    getToken,
  );
  setAccountSettings(saved);
  return saved;
}

/** Reads the settings again, for after a write elsewhere that can change them. */
export async function reloadAccountSettings(getToken: GetToken): Promise<Settings> {
  const saved = await apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken);
  setAccountSettings(saved);
  return saved;
}
