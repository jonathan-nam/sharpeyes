// GET /api/groups, and what every group write answers with. See backend groups/GroupViews.kt.

export type GroupMember = {
  username: string | null;
  name: string | null;
  // Backend-relative, resolve with spriteUrl().
  spriteImgUrl: string | null;
  image: string | null;
  you: boolean;
  /** On your friends list. Only a friend's characters seat without an invite. */
  friend: boolean;
};

export type GroupInvitee = { id: string; member: GroupMember };

/** A friend who is friends with every member, so may be invited. */
export type InvitableFriend = { personId: string; name: string };

export type Group = {
  id: string;
  name: string;
  members: GroupMember[];
  invited: GroupInvitee[];
  invitable: InvitableFriend[];
};

/** GET /api/groups/{id}/roster: one character per groupmate, and who it left out. */
export type GroupRoster = { members: string[]; missing: string[] };

export type IncomingGroupInvite = {
  id: string;
  group: string;
  from: string | null;
  members: number;
};

export type Groups = { groups: Group[]; invites: IncomingGroupInvite[] };

export type SaveGroupBody = { name: string };

export type InviteToGroupBody = { personId: string };
