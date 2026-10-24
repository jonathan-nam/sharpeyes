// What a typed character name has to be to be one. The backend asks Nexon only about names that pass
// the same test (MAX_IGN_LENGTH in sprites/IgnSprites.kt), so the two must not drift.

/** The longest name the game allows. Nexon's endpoint truncates past it. */
export const MAX_IGN_LENGTH = 12;

/** Whether a name could be a character at all. */
export function isIgn(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_IGN_LENGTH && !/\s/.test(trimmed);
}
