import type { Party, Person, SavePeopleBody } from "@/types/party";

/**
 * One row of the People page while it is being edited.
 *
 * `characters` is what this account said and is what gets saved (as SavePeopleBody). `owned` is
 * what a linked person's own account holds: carried so the row can draw it and the pile can leave
 * it alone, never sent back, because it is not this account's to state.
 */
export type PersonDraft = {
  id?: string;
  name: string;
  characters: string[];
  owned: string[];
  linked?: boolean;
  /** Their Discord avatar, when linked. Read-only, from the server. */
  image?: string | null;
  /** Filed under them, not on their account. Read-only, from the server. See PersonResponse. */
  notOnAccount?: string[];
  /** Theirs, and also on another account you are linked to. */
  contested?: string[];
};

// The backend claims a character case-insensitively (see validatePeople), so every comparison here
// has to as well, or the page would offer a name it thinks is free and the save would refuse it.
const key = (name: string) => name.trim().toLowerCase();

/**
 * Whether a character is somebody you actually run with, as against a name that turned up once.
 *
 * Read off the app's own two flags rather than counting appearances: a seat is `guest` when it is
 * not in the party's usual roster, and a config is `oneOff` when it is on for one period rather
 * than every one. A duo partner you run a single boss with is in exactly one party and is a
 * regular, so counting parties would hide them.
 */
export function isRegular(name: string, parties: Party[]): boolean {
  const wanted = key(name);
  return parties.some(
    (party) =>
      !party.oneOff && party.seats.some((seat) => key(seat.name) === wanted && !seat.guest),
  );
}

/**
 * The characters this page offers to attribute: a regular in some party, that nobody holds yet.
 *
 * Two kinds are left out for good, neither of them a question this page can answer.
 *
 * Your own, because for a character on your account "whose is this?" is already answered by it
 * being on your account. Known both ways, since either alone leaves a gap: `mine` is your roster by
 * name, which covers a seat predating the link, and `seat.characterId` covers a character added to
 * a party since, whose name you may have spelled differently on the roster page.
 *
 * And one-offs, because a guest who turned up once is not somebody you keep a person for. They are
 * not offered and not counted: this is not a pile with something held back from it, it is the pile
 * of people worth naming. Type a name in if you want one anyway.
 */
export function unclaimed(parties: Party[], people: PersonDraft[], mine: string[] = []): string[] {
  // Owned counts as claimed. A character whose own account says whose it is is not a question this
  // page has left to ask, and offering it in the pile would invite an attribution that the next
  // read would overrule anyway.
  const claimed = new Set(
    people.flatMap((person) => [...person.characters, ...person.owned].map(key)),
  );
  const yours = new Set(mine.map(key));
  for (const party of parties) {
    for (const seat of party.seats) {
      if (seat.characterId) yours.add(key(seat.name));
    }
  }
  // Every seat a config has ever had, not just this week's roster: somebody who has left the party
  // is still owed their share, and whose character they were is still worth saying.
  const names = new Map<string, string>();
  for (const party of parties) {
    for (const seat of party.seats) {
      const seatKey = key(seat.name);
      if (seatKey === "" || claimed.has(seatKey) || yours.has(seatKey) || names.has(seatKey)) {
        continue;
      }
      names.set(seatKey, seat.name);
    }
  }
  return [...names.values()]
    .filter((name) => isRegular(name, parties))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Gives a character to one person, or to nobody at all.
 *
 * Taken off whoever holds it first, always. A character belongs to one person, so dropping it on a
 * second one is a move rather than a second claim, and the save that would have been refused for
 * "two people claim the same character" can no longer be built.
 */
export function claim(
  people: PersonDraft[],
  name: string,
  personIndex: number | null,
): PersonDraft[] {
  if (personIndex !== null && (personIndex < 0 || personIndex >= people.length)) return people;
  const wanted = key(name);
  const stripped = people.map((person) => ({
    ...person,
    characters: person.characters.filter((character) => key(character) !== wanted),
  }));
  if (personIndex === null) return stripped;
  return stripped.map((person, index) =>
    index === personIndex ? { ...person, characters: [...person.characters, name] } : person,
  );
}

/**
 * The names on a row that this account still has to speak for.
 *
 * A character can be both attributed and owned: you said it was theirs before they linked, and
 * their account now says so too. The attribution is left in the database, because it is still the
 * answer if they ever unlink, but the row draws each character once and draws it as owned.
 */
export function stillAttributed(person: PersonDraft): string[] {
  const owned = new Set(person.owned.map(key));
  return person.characters.filter((name) => !owned.has(key(name)));
}

/** Whether this row already plays [name], however that came to be known. */
export function plays(person: PersonDraft, name: string): boolean {
  const wanted = key(name);
  return [...person.characters, ...person.owned].some((held) => key(held) === wanted);
}

/**
 * The board's rows, from what the API said.
 *
 * `ownedCharacters` is read as OPTIONAL even though the server always sends it (encodeDefaults is
 * on). lib/cache.ts is a stale-while-revalidate store that lives as long as the tab does, so a page
 * opened before a deploy seeds its state from a payload that predates the new field, and the People
 * page reaches this on its very first render, through `dirty`, before any fetch has replaced it.
 * Spreading the undefined threw "p.ownedCharacters is not iterable" and took the page down until a
 * hard reload.
 *
 * So: every field this app adds to a cached DTO is optional on the way in for one deploy, whatever
 * the type says. The type describes what the server sends, not what a tab is still holding.
 */
export function toDraft(rows: Person[]): PersonDraft[] {
  return rows.map((person) => ({
    id: person.id,
    name: person.name,
    characters: [...(person.characters ?? [])],
    owned: [...(person.ownedCharacters ?? [])],
    linked: person.linked ?? false,
    image: person.image ?? null,
    notOnAccount: [...(person.notOnAccount ?? [])],
    contested: [...(person.contested ?? [])],
  }));
}

/** The People page's save body: rows with a name, each with the characters said to be theirs. */
export function peopleBody(draft: PersonDraft[]): SavePeopleBody {
  return {
    people: draft
      .filter((row) => row.name.trim() !== "")
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        name: row.name.trim(),
        characters: row.characters,
      })),
  };
}

/**
 * [character] filed under the person named [personName], a new row when nobody is. The name is
 * matched as the People page shows it, ignoring case, and the character goes through claim, so it
 * leaves whoever held it before.
 */
export function fileUnder(
  people: PersonDraft[],
  personName: string,
  character: string,
): PersonDraft[] {
  const at = people.findIndex((row) => key(row.name) === key(personName));
  const rows =
    at >= 0 ? people : [...people, { name: personName.trim(), characters: [], owned: [] }];
  return claim(rows, character, at >= 0 ? at : rows.length - 1);
}

/** What a character on [row] needs said about it, if anything: see notOnAccount and contested. */
export function characterNote(row: PersonDraft, name: string): string | null {
  if (row.contested?.some((n) => key(n) === key(name))) return "On two accounts";
  if (row.notOnAccount?.some((n) => key(n) === key(name))) return "Not on their account";
  return null;
}

/** [row]'s contested names that are not on its card already, so the clash is still shown. */
export function contestedOffCard(row: PersonDraft): string[] {
  const shown = new Set([...row.characters, ...row.owned].map(key));
  return (row.contested ?? []).filter((name) => !shown.has(key(name)));
}

/**
 * The rows split by whether they sign in as an account of their own, each keeping its index in
 * [people], which is what every edit is addressed by. A section with nobody in it is left out.
 */
export function sectionsOf(
  people: PersonDraft[],
): { title: "Verified" | "Unverified"; rows: { row: PersonDraft; index: number }[] }[] {
  const indexed = people.map((row, index) => ({ row, index }));
  return [
    { title: "Verified" as const, rows: indexed.filter(({ row }) => row.linked) },
    { title: "Unverified" as const, rows: indexed.filter(({ row }) => !row.linked) },
  ].filter((section) => section.rows.length > 0);
}
