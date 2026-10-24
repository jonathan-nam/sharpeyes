"use client";

// The sprite and job of any character named on screen, looked up when the page has none for it.
//
// A page knows the sprites and jobs of your characters, and the sprites of party seats. A name typed
// anywhere else, or filed under a person who does not use the app, has neither until something asks
// Nexon, and the one place that asks is POST /api/sprites/lookup (backend sprites/IgnSprites.kt),
// which remembers every answer. Every screen that takes a typed IGN resolves through
// useCharacterLookup, so they cannot disagree about a character.

import { useEffect, useReducer } from "react";
import { apiFetch } from "@/lib/api";
import { isIgn } from "@/lib/ign";
import { useAuth } from "@/lib/use-auth";

const LOOKUP_KEY = "/api/sprites/lookup";
/** Mirrors MAX_LOOKUP_NAMES in IgnSprites.kt. */
const BATCH = 30;
/** How long a name must stop changing before it is asked about, so typing does not ask per key. */
const SETTLE_MS = 600;

/** What a lookup said about one name. Both null for a name Nexon does not have. */
export type Answer = { sprite: string | null; job: string | null };

/** Answers by lowercased name. A name present was asked about, whatever came back. */
export type Looked = Map<string, Answer>;

type Known = (name: string) => string | null;

/**
 * The names worth asking about, spelled as given: IGN-shaped, not asked yet, and missing something
 * the page needs, a sprite always and a job where `knownJob` is passed.
 */
export function namesToAsk(
  names: string[],
  known: Known,
  looked: Looked,
  asking: Set<string>,
  knownJob?: Known,
): string[] {
  const out = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!isIgn(name) || looked.has(key) || asking.has(key)) continue;
    const missing = known(name) === null || (knownJob !== undefined && knownJob(name) === null);
    if (missing && !out.has(key)) out.set(key, name);
  }
  return [...out.values()];
}

/** A name's sprite: what the page has, else what a lookup found, else none. */
export function spriteOf(name: string, known: Known, looked: Looked): string | null {
  return known(name) ?? looked.get(name.trim().toLowerCase())?.sprite ?? null;
}

/** A name's job: what the page has, else what a lookup found, else unknown. */
export function jobOf(name: string, knownJob: Known, looked: Looked): string | null {
  return knownJob(name) ?? looked.get(name.trim().toLowerCase())?.job ?? null;
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
      const result = await apiFetch<{
        sprites: Record<string, string | null>;
        // Absent from a backend that predates jobs: read as unknown.
        jobs?: Record<string, string | null>;
      }>(LOOKUP_KEY, { method: "POST", body: JSON.stringify({ names: batch }) }, getToken);
      for (const name of batch) {
        looked.set(name.toLowerCase(), {
          sprite: result.sprites[name] ?? null,
          job: result.jobs?.[name] ?? null,
        });
      }
    } catch {
      // Not recorded, so the next render asks again. A frame stays empty meanwhile.
    } finally {
      for (const name of batch) asking.delete(name.toLowerCase());
    }
  }
  for (const listener of listeners) listener();
}

const noJob: Known = () => null;

/**
 * Sprite and job resolvers for these names: the page's own first (`known`, `knownJob`), then a
 * lookup for the rest, asked once the names settle. Re-renders when an answer arrives. Jobs are only
 * looked up when `knownJob` is passed, so a page that draws no jobs does not ask for them.
 */
export function useCharacterLookup(
  names: string[],
  known: Known,
  knownJob?: Known,
): { sprite: (name: string) => string | null; job: (name: string) => string | null } {
  const { getToken, isLoaded } = useAuth();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  const wanted = namesToAsk(names, known, looked, asking, knownJob);
  const key = wanted.join("\n");
  useEffect(() => {
    if (!isLoaded || key === "") return;
    const timer = setTimeout(() => void ask(key.split("\n"), getToken), SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isLoaded]);

  return {
    sprite: (name) => spriteOf(name, known, looked),
    job: (name) => jobOf(name, knownJob ?? noJob, looked),
  };
}

/** useCharacterLookup for a page that draws sprites only. */
export function useCharacterSprites(
  names: string[],
  known: Known,
): (name: string) => string | null {
  return useCharacterLookup(names, known).sprite;
}
