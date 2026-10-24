import { seeded } from "@/lib/golden";

// Records what one money module is asked by another while the Drop Log's figures are worked out, so
// each module's backend port has cases with real inputs. See lib/money.golden.test.ts, which mocks
// every money module with wrapModule. Imports no money module itself, or the mock would wrap it.

/** A call as recorded: its arguments and result, both in goldenJson form. */
export type RecordedCall = { args: unknown; result: unknown } | { args: unknown; throws: true };

/**
 * Tagged JSON, the one shape both sides compare in. A Map is its entries in order, a Set its values;
 * undefined is dropped from an object and null in an array, which the Kotlin side reads as absent.
 * Null for a value that holds a function, which cannot be replayed.
 */
export function goldenJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "function") throw new NotReplayable();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { $num: String(value) };
    return value;
  }
  if (typeof value !== "object") return value;
  if (value instanceof Map)
    return { $map: [...value.entries()].map(([k, v]) => [goldenJson(k), goldenJson(v)]) };
  if (value instanceof Set) return { $set: [...value].map(goldenJson) };
  if (Array.isArray(value)) return value.map(goldenJson);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = goldenJson(v);
  return out;
}

class NotReplayable extends Error {}

/**
 * The most calls kept per function, reservoir-sampled so a long run is not just its first page, and
 * the largest call kept. The repo's fixtures want both small; an audit outside the repo wants neither.
 */
const limits = { kept: 60, bytes: 20_000 };

type Store = { seen: Set<string>; kept: { key: string; call: RecordedCall }[]; count: number };

const store = new Map<string, Store>();
let random = seeded(7);
let on = false;

/** Forgets every call and restarts the sampling, so one run records the same calls every time. */
export function resetRecording(kept: number, bytes: number) {
  store.clear();
  random = seeded(7);
  limits.kept = kept;
  limits.bytes = bytes;
}

/** Turns recording on for [run] only. Nested calls inside a recorded call are recorded too. */
export function recording<T>(run: () => T): T {
  on = true;
  try {
    return run();
  } finally {
    on = false;
  }
}

/** Every module's calls, by `module.function`, in a stable order. */
export function recorded(): Map<string, RecordedCall[]> {
  return new Map(
    [...store.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([fn, s]) => [
        fn,
        [...s.kept].sort((a, b) => (a.key < b.key ? -1 : 1)).map((k) => k.call),
      ]),
  );
}

function keep(fn: string, call: RecordedCall) {
  const key = JSON.stringify(call);
  if (key.length > limits.bytes) return;
  const s = store.get(fn) ?? { seen: new Set<string>(), kept: [], count: 0 };
  store.set(fn, s);
  if (s.seen.has(key)) return;
  s.seen.add(key);
  s.count += 1;
  if (s.kept.length < limits.kept) s.kept.push({ key, call });
  else {
    const at = Math.floor(random() * s.count);
    if (at < limits.kept) s.kept[at] = { key, call };
  }
}

/** [mod] with every exported function recording its calls while recording() is running. */
export function wrapModule<M extends Record<string, unknown>>(name: string, mod: M): M {
  const out: Record<string, unknown> = { ...mod };
  for (const [key, value] of Object.entries(mod)) {
    if (typeof value !== "function" || !/^[a-z]/.test(key)) continue;
    const real = value as (...args: unknown[]) => unknown;
    out[key] = (...args: unknown[]) => {
      if (!on) return real(...args);
      let encoded: unknown;
      try {
        encoded = goldenJson(args);
      } catch {
        return real(...args);
      }
      try {
        const result = real(...args);
        try {
          keep(`${name}.${key}`, { args: encoded, result: goldenJson(result) });
        } catch {
          // A result holding a function is not replayable; the call is simply not kept.
        }
        return result;
      } catch (error) {
        keep(`${name}.${key}`, { args: encoded, throws: true });
        throw error;
      }
    };
  }
  return out as M;
}
