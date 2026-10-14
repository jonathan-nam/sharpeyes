import { splitStacks } from "@/lib/piece-stacks";
import type { BossPiece } from "@/types/boss";
import type { Party } from "@/types/party";

/**
 * What the Add form opens on: the pile the config's mode drops, divided in whole stacks by each
 * seat's piece ratio among the week's roster. Only a starting point, the way a coupon's count is.
 */
export function draftPile(
  party: Party,
  piece: BossPiece,
): { total: number; takes: Record<string, number> } {
  const stacks = splitStacks(
    piece.quantity / piece.stackSize,
    party.members.map((m) => m.pieceShares ?? 1),
  );
  return {
    total: piece.quantity,
    takes: Object.fromEntries(
      party.members.map((m, i) => [m.id, (stacks[i] ?? 0) * piece.stackSize]),
    ),
  };
}

/** Why these takes cannot be saved, or null. The server checks the same and refuses alike. */
export function pileProblem(
  total: number | null,
  takes: (number | null)[],
  stackSize: number,
): string | null {
  if (total === null || takes.some((n) => n === null)) return "Whole numbers only.";
  if (takes.some((n) => n! % stackSize !== 0)) return `Stacks of ${stackSize}.`;
  const sum = takes.reduce<number>((a, n) => a + n!, 0);
  return sum === total ? null : `These come to ${sum} of ${total}.`;
}

/** A typed count, or null when it is not a whole number of pieces. */
export function parseCount(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null;
}
