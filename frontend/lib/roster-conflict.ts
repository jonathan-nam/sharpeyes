import { ApiError } from "./api";
import type { RosterConflict, RosterMove } from "@/types/party";

/**
 * The move a refused save is offering, or null where it is not offering one.
 *
 * Every field is checked rather than cast. The body is JSON the screen turns into a question about
 * removing one of the user's parties, so a shape this build does not recognise has to read as "no
 * offer" and fall back to the flat refusal: half a parsed conflict would name the wrong party, or
 * claim a party survives a move that removes it.
 */
export function rosterConflictOf(error: unknown): RosterConflict | null {
  if (!(error instanceof ApiError) || error.status !== CONFLICT) return null;
  let body: unknown;
  try {
    body = JSON.parse(error.body);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { message, moves } = body as { message?: unknown; moves?: unknown };
  if (typeof message !== "string" || !Array.isArray(moves) || moves.length === 0) return null;
  const parsed = moves.map(asMove);
  if (parsed.some((m) => m === null)) return null;
  return { message, moves: parsed as RosterMove[] };
}

/** 409, which is what a clash comes back as: the request is writable, one question stands. */
const CONFLICT = 409;

function asMove(value: unknown): RosterMove | null {
  if (typeof value !== "object" || value === null) return null;
  const { partyId, member, fromCharacter, removesParty } = value as Record<string, unknown>;
  if (typeof partyId !== "string" || partyId === "") return null;
  if (typeof member !== "string" || member === "") return null;
  if (typeof fromCharacter !== "string" || fromCharacter === "") return null;
  if (typeof removesParty !== "boolean") return null;
  return { partyId, member, fromCharacter, removesParty };
}

/**
 * What the move does, one line per party it takes somebody out of.
 *
 * The effect, not the rule behind it: that a character is in one party per boss is why the question
 * is being asked and is not itself worth a sentence. What the user cannot see coming is the second
 * clause, a party that had two people in it and now has none, so that is the part said out loud.
 */
export function moveLines(moves: RosterMove[]): string[] {
  return moves.map((m) =>
    m.removesParty
      ? `${m.member} leaves ${m.fromCharacter}'s party, which goes with them.`
      : `${m.member} leaves ${m.fromCharacter}'s party.`,
  );
}
