// GET /api/notifications, and what every notification write answers with. See NotificationsResponse.kt.

/** Who caused one, as their main character. */
export type Actor = {
  name: string | null;
  username: string | null;
  // Backend-relative, resolve with spriteUrl().
  spriteImgUrl: string | null;
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
};

export type Notifications = {
  /** The bell's count, across every notification and not only those listed. */
  unread: number;
  notifications: AppNotification[];
};
