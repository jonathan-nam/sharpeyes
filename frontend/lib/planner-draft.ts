// The Party Planner's inputs, as kept between visits.
//
// In the browser until plans are stored server-side (docs/party-planner-plan.md, phase 2). Read
// defensively: an old tab or a hand-edited value must come back as a smaller draft, never as a
// throw or as a strength outside the slider.
//
// Every character the app knows of (yours, and your People's) has a card by default, so the draft
// stores only the exceptions: the known ones taken off the page, and the typed IGNs nobody holds.

import { SOLO, type Want } from "@/lib/party-planner";

export const DRAFT_KEY = "party-planner-draft";

/** You, in a draft. Anybody else is a People-page person id. */
export const YOU = "you";

export type DraftCharacter = { name: string; personId: string };

/** A boss row on a character. Blank boss or mode is a row still being filled in. */
export type DraftWant = {
  character: string;
  bossKey: string;
  difficulty: string;
  strength: number;
  maxParty: number | null;
};

export type Draft = {
  maxMinutes: number;
  /** Characters added by hand: typed IGNs, and known ones from before they were shown by default. */
  characters: DraftCharacter[];
  /** Known characters taken off the page, lowercased. */
  hidden: string[];
  wants: DraftWant[];
};

/** Characters you know of, grouped by who plays them. */
export type RosterGroup = { personId: string; label: string; names: string[] };

/** A typed IGN that is nobody's on record. Its own player, so no rule mistakes it for an alt. */
export function standaloneId(name: string): string {
  return `ign:${name.toLowerCase()}`;
}

/** The longest IGN the game allows. */
export const MAX_IGN = 12;

/** Whose a known character is, keyed by its lowercased name. The first group to name it wins. */
function knownCharacters(roster: RosterGroup[]): Map<string, DraftCharacter> {
  const known = new Map<string, DraftCharacter>();
  for (const group of roster) {
    for (const name of group.names) {
      const key = name.toLowerCase();
      if (!known.has(key)) known.set(key, { name, personId: group.personId });
    }
  }
  return known;
}

/** The cards on the page: every known character not hidden, in roster order, then the typed ones. */
export function shownCharacters(draft: Draft, roster: RosterGroup[]): DraftCharacter[] {
  const known = knownCharacters(roster);
  const hidden = new Set(draft.hidden);
  const shown = [...known].filter(([key]) => !hidden.has(key)).map(([, c]) => c);
  const typed = draft.characters.filter(
    (c) => !known.has(c.name.toLowerCase()) && !hidden.has(c.name.toLowerCase()),
  );
  return [...shown, ...typed];
}

/**
 * What a typed name adds: a known character with its owner, else a standalone one, else nothing.
 *
 * Names match case-blind, as the game's do, and a known one comes back spelled as it is on record.
 * Null for a blank, a name the game would not take, or a character already on the page.
 */
export function resolveCharacter(
  typed: string,
  roster: RosterGroup[],
  shown: DraftCharacter[],
): DraftCharacter | null {
  const name = typed.trim();
  if (name === "" || name.length > MAX_IGN || /\s/.test(name)) return null;
  const key = name.toLowerCase();
  if (shown.some((c) => c.name.toLowerCase() === key)) return null;
  return knownCharacters(roster).get(key) ?? { name, personId: standaloneId(name) };
}

/** The draft with a character back on the page: a known one unhidden, a typed one added. */
export function addCharacter(draft: Draft, roster: RosterGroup[], c: DraftCharacter): Draft {
  const key = c.name.toLowerCase();
  if (knownCharacters(roster).has(key)) {
    return { ...draft, hidden: draft.hidden.filter((h) => h !== key) };
  }
  return { ...draft, characters: [...draft.characters, c] };
}

/** The draft without a character or its bosses. A known one is hidden, since it would come back. */
export function removeCharacter(draft: Draft, roster: RosterGroup[], name: string): Draft {
  const key = name.toLowerCase();
  const wants = draft.wants.filter((w) => w.character !== name);
  if (knownCharacters(roster).has(key)) {
    return { ...draft, hidden: [...new Set([...draft.hidden, key])], wants };
  }
  return { ...draft, characters: draft.characters.filter((c) => c.name !== name), wants };
}

export const MIN_MINUTES = 10;
export const MAX_MINUTES = 30;

export const EMPTY_DRAFT: Draft = {
  maxMinutes: MAX_MINUTES,
  characters: [],
  hidden: [],
  wants: [],
};

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readDraft(text: string | null): Draft {
  return parseDraft(parseJson(text));
}

/** This browser's working copy, and when it was last edited. A save counts as an edit at its time. */
export type LocalDraft = { draft: Draft; editedAt: number };

/** The working copy as stored. A plain draft from before saving existed reads as never edited. */
export function readLocal(text: string | null): LocalDraft | null {
  const raw = parseJson(text);
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!("draft" in r)) return { draft: parseDraft(r), editedAt: 0 };
  const editedAt = Number(r.editedAt);
  return { draft: parseDraft(r.draft), editedAt: Number.isFinite(editedAt) ? editedAt : 0 };
}

/** What the account last saved. Mirrors the backend's SavedPlannerResponse. */
export type SavedPlanner = { draft: unknown; savedAt: string | null };

/**
 * What the page opens on: this browser's edits if they came after the account's save, else the save.
 *
 * So an unsaved change survives a reload here, and another device's newer save is never hidden
 * behind an old copy left in this one.
 */
export function pickDraft(local: LocalDraft | null, saved: SavedPlanner): Draft {
  const savedAt = saved.savedAt === null ? Number.NaN : Date.parse(saved.savedAt);
  if (saved.draft != null && (local === null || !(local.editedAt > savedAt))) {
    return parseDraft(saved.draft);
  }
  return local?.draft ?? EMPTY_DRAFT;
}

/** Two drafts as one comparable string, for telling edited from saved. */
export function draftKey(draft: Draft): string {
  return JSON.stringify({ ...draft, hidden: [...draft.hidden].sort() });
}

export function parseDraft(raw: unknown): Draft {
  if (typeof raw !== "object" || raw === null) return EMPTY_DRAFT;
  const r = raw as Record<string, unknown>;
  const minutes = Number(r.maxMinutes);
  const characters = (Array.isArray(r.characters) ? r.characters : []).filter(
    (c): c is DraftCharacter => typeof c?.name === "string" && typeof c?.personId === "string",
  );
  const hidden = (Array.isArray(r.hidden) ? r.hidden : []).filter(
    (h): h is string => typeof h === "string",
  );
  // Not checked against `characters`: a known character's bosses belong to a card the roster draws.
  const wants = (Array.isArray(r.wants) ? r.wants : []).filter(
    (w): w is DraftWant =>
      typeof w?.character === "string" &&
      typeof w.bossKey === "string" &&
      typeof w.difficulty === "string" &&
      Number.isInteger(w.strength) &&
      w.strength >= 0 &&
      w.strength <= SOLO &&
      (w.maxParty === null || (Number.isInteger(w.maxParty) && w.maxParty >= 1)),
  );
  return {
    maxMinutes:
      Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES
        ? minutes
        : MAX_MINUTES,
    characters,
    hidden: hidden.map((h) => h.toLowerCase()),
    wants,
  };
}

/** The filled-in rows of the characters on the page, as the planner takes them. */
export function draftWants(draft: Draft, shown: DraftCharacter[]): Want[] {
  const owner = new Map(shown.map((c) => [c.name, c.personId]));
  return draft.wants.flatMap((w) => {
    const personId = owner.get(w.character);
    if (personId === undefined || w.bossKey === "" || w.difficulty === "") return [];
    return [
      {
        id: `${w.character}\n${w.bossKey}`,
        character: w.character,
        personId,
        world: null,
        bossKey: w.bossKey,
        difficulty: w.difficulty,
        strength: w.strength,
        maxParty: w.maxParty,
      },
    ];
  });
}
