"use client";

// The sprite of any character named on screen, looked up when the page has none for it.
//
// A page knows the sprites of your characters and of party seats. A name typed anywhere else (filed
// under a person, added to the planner) has none until something asks Nexon, and the one place that
// asks is POST /api/sprites/lookup (backend sprites/IgnSprites.kt), which remembers every answer.
// Every screen that takes a typed IGN resolves its sprites through useCharacterSprites, so they
// cannot disagree about whether one exists.

import { useEffect, useReducer } from "react";
import { apiFetch } from "@/lib/api";
import { isIgn } from "@/lib/ign";
import { useAuth } from "@/lib/use-auth";

const LOOKUP_KEY = "/api/sprites/lookup";
/** Mirrors MAX_LOOKUP_NAMES in IgnSprites.kt. */
const BATCH = 30;
/** How long a name must stop changing before it is asked about, so typing does not ask per key. */
const SETTLE_MS = 600;

/** What a lookup said, by lowercased name: a sprite path, or null for a name Nexon does not have. */
export type Looked = Map<string, string | null>;

/** The names worth asking about: IGN-shaped, not drawn already, not asked yet. Spelled as given. */
export function namesToAsk(
  names: string[],
  known: (name: string) => string | null,
  looked: Looked,
  asking: Set<string>,
): string[] {
  const out = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!isIgn(name) || known(name) !== null || looked.has(key) || asking.has(key)) continue;
    if (!out.has(key)) out.set(key, name);
  }
  return [...out.values()];
}

/** A name's sprite: what the page has, else what a lookup found, else none. */
export function spriteOf(
  name: string,
  known: (name: string) => string | null,
  looked: Looked,
): string | null {
  return known(name) ?? looked.get(name.trim().toLowerCase()) ?? null;
}

// For the whole visit, across pages: an answer is the same wherever the name is typed.
const looked: Looked = new Map();
const asking = new Set<string>();
const listeners = new Set<() => void>();

async function ask(names: string[], getToken: () => Promise<string | null>) {
  for (const name of names) asking.add(name.toLowerCase());
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    try {
      const result = await apiFetch<{ sprites: Record<string, string | null> }>(
        LOOKUP_KEY,
        { method: "POST", body: JSON.stringify({ names: batch }) },
        getToken,
      );
      for (const name of batch) looked.set(name.toLowerCase(), result.sprites[name] ?? null);
    } catch {
      // Not recorded, so the next render asks again. A frame stays empty meanwhile.
    } finally {
      for (const name of batch) asking.delete(name.toLowerCase());
    }
  }
  for (const listener of listeners) listener();
}

/**
 * A sprite resolver for these names: `known` first (the page's own sprites), then a lookup for the
 * rest, asked once the names settle. Re-renders when an answer arrives.
 */
export function useCharacterSprites(
  names: string[],
  known: (name: string) => string | null,
): (name: string) => string | null {
  const { getToken, isLoaded } = useAuth();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  const wanted = namesToAsk(names, known, looked, asking);
  const key = wanted.join("\n");
  useEffect(() => {
    if (!isLoaded || key === "") return;
    const timer = setTimeout(() => void ask(key.split("\n"), getToken), SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isLoaded]);

  return (name) => spriteOf(name, known, looked);
}
