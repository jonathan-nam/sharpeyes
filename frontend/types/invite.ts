// Mirrors backend's invites/InviteDtos.kt field-for-field.

/** A config the link could not carry, named so the drop is visible rather than inferred. */
export type InviteOmission = {
  bossKey: string;
  characterName: string;
  reason: string;
};

/**
 * A link you have made for somebody.
 *
 * `token` comes back once, on the response that created it, and never again: the backend stores
 * only its hash, so a link that was not copied is replaced rather than recovered.
 */
export type Invite = {
  id: string;
  personId: string;
  personName: string;
  senderName: string;
  token?: string | null;
  createdAt: string;
  expiresAt: string;
  accepted: boolean;
  characterCount: number;
  partyCount: number;
  omitted: InviteOmission[];
};

/**
 * One config on a link's landing page.
 *
 * The boss's NAME, because that page is read before anyone signs in and so cannot fetch the catalog
 * to turn a key into one. `characterName` is whichever of YOUR characters holds the seat, which is
 * what tells two configs on one boss apart and which ticked character each party arrives with.
 */
export type InvitePartyLabel = {
  bossName: string;
  difficulty: string | null;
  characterName: string;
};

/** What a link offers, read without an account. */
export type InvitePreview = {
  senderName: string;
  // The sender's sprite for that character. Absent or null when their account has none.
  senderSprite?: string | null;
  characters: string[];
  // The configs this link seats you in, one entry each.
  parties: InvitePartyLabel[];
  peopleCount: number;
  omitted: InviteOmission[];
};

/** What accepting created. */
export type AcceptedInvite = {
  charactersCreated: number;
  peopleCreated: number;
  partiesCreated: number;
  omitted: InviteOmission[];
};

/** Who to make a link for. The name it is sent under is the server's to decide: see senderNameFor. */
export type CreateInviteBody = {
  personId: string;
};
