// GET /api/party-combines, and what every write there answers with. See backend CombineRoutes.kt.

export type CombineSide = {
  partyId: string;
  leader: string;
  difficulty: string | null;
  /** Standing seats, the owner's own included. */
  members: string[];
};

export type CombinePair = {
  bossKey: string;
  boss: string;
  /** Your name for the other owner, from People. */
  friend: string;
  friendImage: string | null;
  mine: CombineSide;
  theirs: CombineSide;
  /** Party ids that can be kept: the one already seating the other owner's character. */
  keepable: string[];
  /** ISO date the kept party is shared from, if combined now. */
  sharedFrom: string;
  proposal: { id: string; keepPartyId: string; yours: boolean } | null;
};

export type CombinePage = {
  pairs: CombinePair[];
};
