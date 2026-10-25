// GET /api/friends, and what every friend write answers with. See FriendRoutes.kt.

/** Somebody else's account: a request's id on a request, the person's id on a friend. */
export type FriendView = {
  id: string;
  username: string | null;
  /** What you call them on a friend, their main character on a request. */
  name: string | null;
  // Backend-relative, resolve with spriteUrl().
  spriteImgUrl: string | null;
  /** Their current Discord avatar. Absent on a cached payload. */
  image?: string | null;
};

export type Social = {
  /** Yours. Null until you have signed in with Discord. */
  username: string | null;
  friends: FriendView[];
  outgoing: FriendView[];
  /** Requests to you. Absent on a cached payload. */
  incoming?: FriendView[];
};

/** GET /api/party-invites: a seat offered to one of your characters. See PartyInvites.kt. */
export type IncomingInvite = {
  id: string;
  partyId: string;
  character: string;
  boss: string;
  difficulty: string | null;
  leader: string;
};
