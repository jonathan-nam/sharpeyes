import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

/**
 * Every character name the app can draw a sprite for, to the backend-relative path of that sprite.
 *
 * Keyed by NAME because that is all a roster box holds: the editor's seats are text, typed and
 * retyped, and a seat is matched to an existing row by name too (see writeMembers). So a name is
 * the only handle a half-typed roster has.
 *
 * Both sources, because either alone leaves gaps. Your own characters cover the ones you have added
 * and nobody else's; the party seats cover everybody you run with, whose sprite the backend looked
 * up when the seat was saved. A seat that never resolved carries null and is simply not in here.
 *
 * Parties you are IN count as much as parties you own. An account that joined by a link owns no
 * config at all, so reading only your own left every face on its People page blank.
 *
 * Resolve what comes out with spriteUrl(): these paths are backend-relative, and assigning one to
 * an <img> unresolved asks the frontend's own origin, which is a 404 in dev and in prod both.
 */
export function spriteByName(characters: Character[], parties: Party[]): Map<string, string> {
  const sprites = new Map<string, string>();
  for (const party of parties) {
    // Every seat, not the week's roster: somebody who has left the party is still drawn on the
    // People page, and reading `members` would leave them the one chip with no art.
    for (const seat of party.seats) {
      if (seat.spriteImgUrl) sprites.set(seat.name, seat.spriteImgUrl);
    }
  }
  // After the seats, not before: your own character's sprite is the one refreshed on your roster
  // page, so where the two disagree it is the newer of them.
  for (const character of characters) {
    if (character.spriteImgUrl) sprites.set(character.name, character.spriteImgUrl);
  }
  return sprites;
}
