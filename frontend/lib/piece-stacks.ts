import type { Boss, BossPiece } from "@/types/boss";

/**
 * The pile a party divides at this mode in this world, or undefined where there is none: a Heroic
 * party, a boss whose pieces are instanced, or a mode that drops nothing.
 */
export function pooledPieceAt(
  boss: Boss | null,
  difficulty: string,
  world: string,
): BossPiece | undefined {
  return (boss?.pieces ?? []).find(
    (p) => p.difficulty === difficulty && p.world === world && p.pooled && p.quantity > 0,
  );
}

/**
 * [stacks] divided by [weights] in whole stacks, largest remainder first, ties to the earlier seat.
 *
 * The backend's splitStacks (tokens/PiecePiles.kt), which is what the clear actually files. The
 * boxes have to open on the same numbers or the config would show one split and file another.
 */
export function splitStacks(stacks: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.reduce((a, b) => a + b, 0) === 0 ? weights.map(() => 1) : weights;
  const sum = w.reduce((a, b) => a + b, 0);
  const floors = w.map((x) => Math.floor((x * stacks) / sum));
  const left = stacks - floors.reduce((a, b) => a + b, 0);
  const extra = new Set(
    w
      .map((x, i) => ({ i, rem: (x * stacks) % sum }))
      .sort((a, b) => b.rem - a.rem || a.i - b.i)
      .slice(0, left)
      .map((r) => r.i),
  );
  return floors.map((f, i) => (extra.has(i) ? f + 1 : f));
}

/** A typed box as whole stacks, or null when it is not one. */
export function parseWholeStacks(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** The stacks as a ratio in lowest terms, which is what is stored. Null when nobody takes any. */
export function sharesFromWholeStacks(stacks: number[]): number[] | null {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = stacks.reduce((a, b) => gcd(a, b), 0);
  return g === 0 ? null : stacks.map((s) => s / g);
}
