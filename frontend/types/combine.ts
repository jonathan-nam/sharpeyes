// GET /api/party-combines, and what every write there answers with. See backend CombineRoutes.kt.

/** A seat: the character and its sprite path (resolve with spriteUrl). */
export type SeatFace = { name: string; sprite: string | null };

export type CombineSide = {
  partyId: string;
  leader: string;
  difficulty: string | null;
  /** Standing seats, the owner's own included. */
  members: SeatFace[];
};

/** A pair the sender has to choose for. */
export type CombineConflict = {
  bossKey: string;
  boss: string;
  mine: CombineSide;
  theirs: CombineSide;
  /** Party ids that can be kept: the one already seating the other owner's character. */
  keepable: string[];
  /** ISO date the kept party is shared from, if combined now. */
  sharedFrom: string;
};

/** Combining with one friend, from the sender's side. */
export type CombineWith = {
  personId: string;
  friend: string;
  friendImage: string | null;
  matched: number;
  /** Pairs that settle themselves, by whose copy they keep. */
  keepsYours: number;
  keepsTheirs: number;
  conflicts: CombineConflict[];
  sentRequestId: string | null;
};

/** A request waiting on you. */
export type IncomingCombine = {
  id: string;
  friend: string;
  friendImage: string | null;
  total: number;
  keepsYours: number;
  keepsTheirs: number;
};

export type CombinePage = {
  friends: CombineWith[];
  incoming: IncomingCombine[];
};
