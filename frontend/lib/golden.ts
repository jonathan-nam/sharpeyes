import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Golden fixtures: the TypeScript's own answers, written where a shared module's Kotlin port reads
// them. The port must reproduce every case exactly. See docs/backend-arithmetic-plan.md, Phase 1.
//
// Each *.golden.test.ts regenerates its file and fails when it differs from the committed one, so a
// change to the arithmetic cannot leave the fixtures behind. UPDATE_GOLDEN=1 rewrites them instead.

/** Where a shared module's port reads its fixtures: `shared/<module>/.../<module>-golden/`. */
function dirOf(module: string): string {
  return fileURLToPath(
    new URL(`../../shared/${module}/src/commonTest/resources/${module}-golden/`, import.meta.url),
  );
}

/** One case: what went in, and what came out or that it was refused. */
export type GoldenCase<I, O> = { input: I; output: O } | { input: I; throws: true };

/** Runs [fn] over every input, recording a refusal as `throws` rather than an answer. */
export function goldenCases<I, O>(inputs: I[], fn: (input: I) => O): GoldenCase<I, O>[] {
  return inputs.map((input) => {
    try {
      return { input, output: fn(input) };
    } catch {
      return { input, throws: true as const };
    }
  });
}

/**
 * The file's text: one case per line, so a diff names the cases that moved. Numbers as JSON writes
 * them, the shortest form that reads back to the same double, which the Kotlin side relies on.
 */
export function goldenText(source: string, cases: unknown[]): string {
  return `{"generatedBy":${JSON.stringify(source)},"cases":[\n${cases
    .map((c) => JSON.stringify(c))
    .join(",\n")}\n]}\n`;
}

/** The committed text of [name], after rewriting it when UPDATE_GOLDEN is set. */
export function committedGolden(name: string, text: string, module = "money"): string {
  const path = `${dirOf(module)}${name}`;
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(path, text);
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** A seeded generator (mulberry32), so the random spread is the same on every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
