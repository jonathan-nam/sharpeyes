// GET /api/notifications, and what every notification write answers with. See NotificationsResponse.kt.

/** Who caused one, as their main character. */
export type Actor = {
  name: string | null;
  username: string | null;
  // Backend-relative, resolve with spriteUrl().
  spriteImgUrl: string | null;
  /** Their current Discord avatar. Absent on a cached payload. */
  image?: string | null;
};

export type AppNotification = {
  id: string;
  /** One of NotificationKind.kt. Drawn by components/notification-kinds.tsx. */
  kind: string;
  /** The row it is about, which a kind's buttons act on. */
  subjectId: string | null;
  createdAt: string;
  read: boolean;
  actor: Actor | null;
  /** Whatever else the kind needs, as the feature that raised it wrote it. */
  payload: Record<string, unknown>;
  /** The sentence, written by the server. Absent for a kind this client still writes itself. */
  text?: string | null;
  /** Its buttons, described by the server. Absent on a cached payload. */
  actions?: NotificationAction[];
};

/** A link has `href`; an answer has `method` and `path`. See NotificationsResponse.kt. */
export type NotificationAction = {
  label: string;
  primary: boolean;
  href: string | null;
  method: string | null;
  path: string | null;
};

export type Notifications = {
  /** The bell's count, across every notification and not only those listed. */
  unread: number;
  notifications: AppNotification[];
};
