"use client";

import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { apiAssetUrl } from "@/lib/api";
import { onLive, type PresencePing } from "@/lib/live-events";
import {
  colorOf,
  controlIn,
  HEARTBEAT_MS,
  type Peer,
  pingAt,
  pointOf,
  regionOf,
  STALE_MS,
  THROTTLE_MS,
} from "@/lib/presence";
import { useAuth, useSessionUser } from "@/lib/use-auth";

// Who is on the page, for CurrentlyViewing. Changes only when somebody arrives or leaves, so the
// row is not redrawn on every cursor move. PresenceLayer is the only writer.
type Viewer = Pick<Peer, "actor" | "name" | "image" | "color">;
let viewers: Viewer[] = [];
const watchers = new Set<() => void>();

function setViewers(next: Viewer[]) {
  const same =
    next.length === viewers.length &&
    next.every((v, i) => v.actor === viewers[i]!.actor && v.image === viewers[i]!.image);
  if (same) return;
  viewers = next;
  watchers.forEach((w) => w());
}

const subscribe = (watcher: () => void) => {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
};

/** The faces of everybody else on this page. Nothing at all when you are alone on it. */
export function CurrentlyViewing() {
  const shown = useSyncExternalStore(
    subscribe,
    () => viewers,
    () => viewers,
  );
  if (shown.length === 0) return null;
  return (
    <div className="presence-viewers" role="group" aria-label="Currently Viewing">
      {shown.map((v) =>
        v.image ? (
          <img
            key={v.actor}
            className="presence-face"
            src={v.image}
            alt={v.name ?? ""}
            title={v.name ?? undefined}
            style={{ borderColor: v.color }}
          />
        ) : (
          <span
            key={v.actor}
            className="presence-face"
            title={v.name ?? undefined}
            style={{ borderColor: v.color, background: v.color }}
          >
            {(v.name ?? "?").slice(0, 1)}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Sends where you are on [page] and draws where everybody else is: their cursor, and an outline on
 * the control they are over. Mounted once on the page, and the only thing redrawn as they move.
 */
export function PresenceLayer({ page }: { page: string }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useSessionUser();
  const me = user?.id ?? null;
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  // Bumped on scroll and resize, so each cursor is placed against the regions where they now are.
  const [, setTick] = useState(0);

  useEffect(
    () =>
      onLive("presence", (event) => {
        const ping = event.presence;
        const actor = event.actor;
        if (!ping || !actor || actor === me || ping.page !== page) return;
        setPeers((prev) => {
          const next = new Map(prev);
          if (!ping.here) {
            next.delete(actor);
          } else {
            next.set(actor, {
              actor,
              name: ping.name ?? null,
              image: event.image ? apiAssetUrl(event.image) : null,
              color: colorOf(actor),
              scope: ping.scope ?? null,
              x: ping.x ?? null,
              y: ping.y ?? null,
              target: ping.target ?? null,
              at: Date.now(),
            });
          }
          return next;
        });
      }),
    [page, me],
  );

  useEffect(() => {
    const prune = window.setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setPeers((prev) => {
        const kept = [...prev].filter(([, p]) => p.at >= cutoff);
        return kept.length === prev.size ? prev : new Map(kept);
      });
    }, 5_000);
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    window.addEventListener("scroll", redraw, { passive: true });
    window.addEventListener("resize", redraw);
    return () => {
      window.clearInterval(prune);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", redraw);
      window.removeEventListener("resize", redraw);
    };
  }, []);

  useEffect(() => {
    setViewers(
      [...peers.values()]
        .sort((a, b) => a.actor.localeCompare(b.actor))
        .map(({ actor, name, image, color }) => ({ actor, name, image, color })),
    );
  }, [peers]);
  useEffect(() => () => setViewers([]), []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) return;
    let last: PresencePing = { page, here: true };
    let sentAt = 0;
    let pending: number | null = null;
    const send = (ping: PresencePing, keepalive = false) => {
      void getToken()
        .then((token) =>
          fetch(apiAssetUrl("/api/presence"), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(ping),
            keepalive,
          }),
        )
        .catch(() => {});
    };
    const flush = () => {
      pending = null;
      sentAt = Date.now();
      send(last);
    };
    const queue = (ping: PresencePing) => {
      last = ping;
      if (pending !== null) return;
      pending = window.setTimeout(flush, Math.max(0, THROTTLE_MS - (Date.now() - sentAt)));
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      queue(pingAt(page, e.clientX, e.clientY, document.elementFromPoint(e.clientX, e.clientY)));
    };
    // Typing into a box is interacting with it, wherever the mouse has wandered.
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return;
      const box = e.target.getBoundingClientRect();
      queue(pingAt(page, box.left + box.width / 2, box.top + box.height / 2, e.target));
    };
    const leave = () => send({ page, here: false }, true);
    const onVisibility = () => (document.hidden ? leave() : flush());

    flush();
    const heartbeat = window.setInterval(flush, HEARTBEAT_MS);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("focusin", onFocus);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(heartbeat);
      if (pending !== null) window.clearTimeout(pending);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      leave();
    };
  }, [page, isLoaded, isSignedIn, getToken]);

  if (peers.size === 0) return null;
  return (
    <div className="presence-layer" aria-hidden="true">
      {[...peers.values()].map((peer) => {
        const point = pointOf(peer);
        const region = peer.scope && peer.target ? regionOf(peer.scope) : null;
        const box =
          region && peer.target ? controlIn(region, peer.target)?.getBoundingClientRect() : null;
        return (
          <Fragment key={peer.actor}>
            {box && (
              <div
                className="presence-outline"
                style={{
                  left: box.left - 3,
                  top: box.top - 3,
                  width: box.width + 6,
                  height: box.height + 6,
                  borderColor: peer.color,
                }}
              />
            )}
            {point && (
              <div
                className="presence-cursor"
                style={{
                  transform: `translate(${point.left}px, ${point.top}px)`,
                  color: peer.color,
                }}
              >
                <svg width="16" height="20" viewBox="0 0 16 20">
                  <path
                    d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z"
                    fill="currentColor"
                    stroke="#fff"
                    strokeWidth="1.2"
                  />
                </svg>
                {peer.name && (
                  <span className="presence-name" style={{ background: peer.color }}>
                    {peer.name}
                  </span>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
