"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/button";
import { kindOf, type KindActions } from "@/components/notification-kinds";
import { apiAssetUrl, apiFetch, failureText, spriteUrl } from "@/lib/api";
import { onFriendsChanged } from "@/lib/friends-changed";
import { useAuth } from "@/lib/use-auth";
import { useDismiss } from "@/lib/use-dismiss";
import { useLive } from "@/lib/use-live";
import type { AppNotification, Notifications } from "@/types/notifications";

const NOTIFICATIONS_KEY = "/api/notifications";

// What is waiting on you, beside the account button. Knows nothing about any one kind: each is
// drawn by notification-kinds.tsx. Asked again on every navigation, so something raised while you
// were on another page shows by the next click.
export function NotificationBell() {
  const { getToken, isLoaded } = useAuth();
  const pathname = usePathname();
  const [state, setState] = useState<Notifications | null>(null);
  // What was unread when the menu opened, kept marked while it stays open: opening is reading
  // them, so the server's flags are already cleared by the time they are drawn.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const call = (path: string, init: RequestInit = { method: "GET" }) =>
    apiFetch<Notifications>(path, init, getToken).then(setState);

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    // A bell that cannot load is a bell with nothing on it, not an error on every page.
    call(NOTIFICATIONS_KEY).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, pathname]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onFriendsChanged(() => void call(NOTIFICATIONS_KEY).catch(() => {})), []);
  // A request arriving, or answered from another tab, shows without a click.
  useLive("notifications", () => void call(NOTIFICATIONS_KEY).catch(() => {}));

  function toggle() {
    const opening = !open;
    setOpen(opening);
    setError(null);
    if (!opening || !state) return;
    setFresh(new Set(state.notifications.filter((n) => !n.read).map((n) => n.id)));
    if (state.unread > 0) {
      call(`${NOTIFICATIONS_KEY}/read`, { method: "POST" }).catch(() => {});
    }
  }

  const run: KindActions["run"] = (write, failure) => {
    setBusy(true);
    setError(null);
    write(getToken)
      .then(() => call(NOTIFICATIONS_KEY))
      .catch((e) => setError(failureText(e, failure)))
      .finally(() => setBusy(false));
  };

  const shown = (state?.notifications ?? []).filter((n) => kindOf(n.kind) !== null);
  const unread = state?.unread ?? 0;

  return (
    <div className="notification-bell" ref={ref}>
      <button
        type="button"
        className="notification-bell-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {/* The game's Golden Bell, 1:1 like every mark. See scripts/build-tab-marks.mjs. */}
        <img className="tab-art" src="/marks/golden-bell.png" alt="" />
        {unread > 0 && <span className="notification-count">{unread}</span>}
      </button>

      {open && (
        <div className="notification-menu" role="menu">
          {shown.length === 0 && <p className="notification-empty">No notifications.</p>}
          {shown.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              fresh={fresh.has(n.id)}
              busy={busy}
              run={run}
              onFollow={() => setOpen(false)}
              onDismiss={() =>
                run(
                  (token) =>
                    apiFetch<unknown>(
                      `${NOTIFICATIONS_KEY}/${encodeURIComponent(n.id)}`,
                      { method: "DELETE" },
                      token,
                    ),
                  "Couldn't dismiss that.",
                )
              }
            />
          ))}
          {error && <p className="routine-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  fresh,
  busy,
  run,
  onDismiss,
  onFollow,
}: KindActions & { fresh: boolean; onDismiss: () => void; onFollow: () => void }) {
  const kind = kindOf(notification.kind)!;
  const { actor, payload } = notification;
  const icon = kind.icon?.(payload);
  const sentence = kind.text?.(payload, actor?.name ?? actor?.username ?? "Somebody");
  return (
    <div className={fresh ? "notification-item is-fresh" : "notification-item"}>
      {/* What changed, with the face of who changed it on its corner. Otherwise the account that
          did it, so its Discord face first; their main's sprite where none. */}
      {icon ? (
        <span className="notification-art">
          <img className="notification-icon" src={apiAssetUrl(icon)} alt="" />
          {actor?.image && <img className="notification-badge" src={actor.image} alt="" />}
        </span>
      ) : actor?.image ? (
        <img className="notification-face" src={actor.image} alt="" />
      ) : actor?.spriteImgUrl ? (
        <span
          className="notification-face sprite-face"
          style={{ backgroundImage: `url("${spriteUrl(actor.spriteImgUrl)}")` }}
          aria-hidden="true"
        />
      ) : (
        <span className="notification-face" aria-hidden="true" />
      )}
      {sentence ? (
        <span className="notification-text">
          <span className="notification-sentence">{sentence}</span>
        </span>
      ) : (
        <span className="notification-text">
          <span className="notification-title">{kind.title}</span>
          {actor && <span className="notification-who">{actor.name ?? actor.username}</span>}
          {actor?.username && actor.name && (
            <span className="notification-handle">@{actor.username}</span>
          )}
        </span>
      )}
      <span className="notification-actions">
        {kind.actions ? (
          kind.actions({ notification, busy, run })
        ) : (
          <>
            {kind.go && (
              <ButtonLink variant="primary" href={kind.go.href(payload)} onClick={onFollow}>
                {kind.go.label(payload)}
              </ButtonLink>
            )}
            <button
              type="button"
              className="notification-dismiss"
              aria-label="Dismiss"
              disabled={busy}
              onClick={onDismiss}
            >
              &times;
            </button>
          </>
        )}
      </span>
    </div>
  );
}
