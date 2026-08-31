// Mirrors backend's parties/PartyDtos.kt field-for-field.

import type { WorldType } from "@/lib/world";

// One seat: a character somebody brought.
export type PartyMember = {
  id: string;
  name: string;
  // Whose character this is, from the people list, matched on the character name. Null means it
  // has not been attributed to anybody yet, which is ordinary.
  personId: string | null;
  personName: string | null;
  // Set when the seat is one of YOUR characters. The config's own character is always the first
  // seat, so this is set on at least one of them.
  characterId: string | null;
  // Backend-relative, resolve with spriteUrl(). See Character.spriteImgUrl.
  spriteImgUrl: string | null;
  // Not in the party's usual roster: here for this week only, or gone from it since. Said out loud
  // because "who is in this party" and "who ran it that week" now have different answers.
  guest: boolean;
  // What this seat is entitled to of the STACKS the party divides, as a ratio: see lib/stacks.ts.
  // Not a money weight. A sale opens even and pins its own counts, whatever this says.
  shares: number;
};

// One config: your character, one boss, and who they run it with. A boss your character solos has
// one of these too, flagged `solo`, so what fell on it has a pool to sit in.
export type Party = {
  id: string;
  // How this config addresses itself in a URL: "rune/lomien", the character and the boss. The id
  // instead for a character whose name cannot be told from another of yours. See lib/party-path.ts.
  slug: string;
  characterId: string;
  // Nobody else was there. One seat, nothing to split, and off every list of parties: only the
  // Drop Log asks for these, and only /api/parties?solo=include returns them.
  solo: boolean;
  // On for one period rather than every one. A boss run once, gone next period without being told
  // to, as against a standing arrangement that is on until somebody says otherwise.
  oneOff: boolean;
  // Taken off the lists, pool kept, because deleting it would have taken a settled split with it.
  // Only /api/parties?retired=include returns these, which the wallet and the Drop Log ask for so
  // the drops stay readable. Not a boss this character runs.
  retired: boolean;
  // The character's world. Heroic worlds do not trade, so this decides whether this pool's drops
  // can be sold at all: see lib/world.ts.
  worldType: WorldType;
  bossKey: string;
  // Which mode this party runs, one of the boss's own difficulties. Null is not NORMAL, it is
  // nobody having said yet, and nothing draws a difficulty for it.
  difficulty: string | null;
  // How long this party takes on this boss, door to door. Null is nobody having timed it, which
  // Run Order fills with a flat estimate and says so. See lib/boss-minutes.ts.
  minutes: number | null;
  // The seat that picks up the pieces, when the party agreed one member loots the lot. Null is
  // everybody looting their own, which is most parties. Not always one of yours: a duo where the
  // partner loots and sells is the easier arrangement on a boss run with a character that is not on
  // your account.
  looterMemberId: string | null;
  // Who ran in the week being shown, your character first. Not always who usually does.
  members: PartyMember[];
  // Every seat this party has ever had, guests and departed members included. What a payout is
  // read against: a share owed to somebody who has since left is still owed, and resolving it
  // through `members` would make the drop unreadable the week after they left.
  seats: PartyMember[];
  // False when this week was spelled out with its own roster. The members alone cannot say so: a
  // week that only drops somebody names no guest and would read as an ordinary one.
  usualRoster: boolean;
  // Not running this boss in the period being shown, whichever way it got there: a standing party
  // taken off the week, or a one-off whose week has passed. Answers for the week the list was asked
  // for, unlike `cleared` below, which always answers for now.
  skippedThisPeriod: boolean;
  // The pool at a glance: dropped but unsold, sold with somebody still unpaid, and sold with
  // nothing left to do. The last one is carried so a fully settled pool is still visible from the
  // list rather than reading as a party that never dropped anything.
  pendingLoot: number;
  awaitingPayout: number;
  settledLoot: number;
  // Whether this boss is cleared in the period it is currently in, straight out of boss_clear:
  // the same row the clear matrix draws and a planner capture writes. Null means nobody has said
  // anything about it this period, which is NOT the same as "not cleared".
  cleared: boolean | null;
  // Ticked here rather than read off a planner capture.
  clearedByHand: boolean;
  createdAt: string;
  updatedAt: string;
};

// A person, and the characters of theirs you have named.
export type Person = {
  id: string;
  name: string;
  characters: string[];
  // Their Settlement Ledger card is drawn with nothing outstanding. Set by hand. See V59.
  pinned: boolean;
};

// What POST /api/parties and PUT /api/parties/{id} take. `members` is the OTHER characters: the
// config already knows whose it is.
export type SavePartyBody = {
  characterId: string;
  bossKey: string;
  members: string[];
  // One of the boss's own difficulties. Omitted or null says nothing, which the server keeps as
  // nothing; anything the boss does not have is refused rather than stored.
  difficulty?: string | null;
  // Minutes door to door, or null for "not timed". Zero is a real answer and is kept as one.
  minutes?: number | null;
  // What each seat usually takes, by character name, your own included. The body is the whole
  // roster, so a name left out takes one share.
  shares?: Record<string, number>;
  // Make this a one-off, on for this period alone. Read at create only: which kind of config it is
  // decides how every later period reads, so flipping it afterwards would rewrite weeks it has
  // already answered for.
  oneOff?: boolean;
  // Who picks up the pieces, by character name rather than seat id: seats are matched by name, and a
  // party being created has no seat ids yet. Null clears it.
  looterName?: string | null;
  // Parties to take these members OUT of, by id, as part of this save. A character is in one party
  // per boss, so this is what turns "already in your HuskyxKenshi party" from a dead end into a
  // move. Only ids the server just offered are accepted, so this cannot be sent blind.
  releaseFrom?: string[];
};

/**
 * The one refusal a save can answer: somebody in the roster is in another party for this boss.
 *
 * Comes back as a 409 rather than a 400, because the request is writable and the screen is being
 * asked a question about it. Answering is the same save again with these party ids in
 * `releaseFrom`. See RosterConflictResponse in PartyDtos.kt.
 */
export type RosterConflict = {
  message: string;
  moves: RosterMove[];
};

export type RosterMove = {
  partyId: string;
  /** The seat that would move, named as the party holding it spells it. */
  member: string;
  /** Whose party it is being taken from. */
  fromCharacter: string;
  /** Whether that party is left with nobody else, so the move removes it. */
  removesParty: boolean;
};

/**
 * What PUT /api/parties/solo takes: which mode a character runs a boss at alone.
 *
 * By character and boss, not by config id. The pool may not exist yet, and naming the mode is what
 * opens it. Refused on a boss that has a party, whose mode is on the config with its roster.
 */
export type SoloDifficultyBody = {
  characterId: string;
  bossKey: string;
  difficulty: string | null;
};

/**
 * What PUT /api/parties/{id}/roster takes: who ran one week.
 *
 * `members` null puts the week back to the usual roster, which is a deletion rather than a copy of
 * it: a copy would freeze the week against every later change to the party.
 *
 * `week` omitted means this week, which is also the only one the server will write. It is taken
 * from the server's clock either way, so a browser a day out cannot file a roster in the wrong one.
 */
export type SaveWeekRosterBody = {
  week?: string | null;
  members: string[] | null;
};

/**
 * What PUT /api/parties/{id}/skip takes: whether this boss is being run this period.
 *
 * False puts it back, by deleting the mark rather than storing a false, so the next period runs as
 * usual without being told to. `week` is omitted for the same reason the roster omits it: only this
 * period may be changed, and the server's clock is the one that decides which it is.
 */
export type SetPartySkipBody = {
  week?: string | null;
  skipped: boolean;
};

// The whole people list, every time.
export type SavePeopleBody = {
  people: { id?: string; name: string; characters: string[] }[];
};
