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

export type Group = {
  id: string;
  name: string;
  members: GroupMember[];
  invited: GroupInvitee[];
};

export type IncomingGroupInvite = {
  id: string;
  group: string;
  from: string | null;
  members: number;
};

export type Groups = { groups: Group[]; invites: IncomingGroupInvite[] };

export type SaveGroupBody = { name: string };

export type InviteToGroupBody = { personId: string };
