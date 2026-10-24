// The one JSON shape the browser's money figures and the backend's (backend/money) are compared in.

/** Thrown for a value holding a function, which no other side could reproduce. */
export class NotReplayable extends Error {}

/**
 * Tagged JSON. A Map is its entries in order, a Set its values; undefined is dropped from an object
 * and null in an array, which the Kotlin side reads as absent.
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

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every path where [actual] departs from [expected], as dotted paths (`view.settlement.2.mesos`),
 * leaving out the `$map` and `$set` tags. The backend's own comparison (backend/money Call.kt):
 * numbers by value, absent the same as null, arrays and Map entries in order.
 */
export function differences(expected: unknown, actual: unknown, path = ""): string[] {
  const at = (key: string | number) =>
    String(key).startsWith("$") ? path : path ? `${path}.${key}` : String(key);
  const e = expected ?? null;
  const a = actual ?? null;
  if (Array.isArray(e) && Array.isArray(a) && e.length === a.length)
    return e.flatMap((item, i) => differences(item, a[i], at(i)));
  if (isObject(e) && isObject(a))
    return [...new Set([...Object.keys(e), ...Object.keys(a)])].flatMap((key) =>
      differences(e[key], a[key], at(key)),
    );
  return e === a ? [] : [path];
}
