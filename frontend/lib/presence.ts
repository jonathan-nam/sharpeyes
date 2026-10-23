// Live presence: where the people you share a party with are on the same page. See backend
// events/Presence.kt. Positions are relative to a `data-presence` region (a party row, the toolbar),
// so a cursor lands on the same thing in every browser whatever its width or scroll.

import type { PresencePing } from "@/lib/live-events";

/** One other account on the page, as last heard. */
export type Peer = {
  actor: string;
  name: string | null;
  image: string | null;
  color: string;
  scope: string | null;
  x: number | null;
  y: number | null;
  target: string | null;
  at: number;
};

/** Gone after this long without a ping. A ping is sent at least every HEARTBEAT_MS. */
export const STALE_MS = 30_000;
export const HEARTBEAT_MS = 10_000;
/** The least time between two pings while the pointer moves. */
export const THROTTLE_MS = 80;

const INTERACTIVE = "button, a, input, select, textarea, [role='tab'], [role='button']";

// Distinct on the app's surfaces in both themes, and none of them the clear/not-cleared colours.
const COLORS = [
  "#e8590c",
  "#1c7ed6",
  "#9c36b5",
  "#2b8a3e",
  "#c2255c",
  "#0b7285",
  "#5f3dc4",
  "#a61e4d",
];

/** One colour per account, the same in every browser. */
export function colorOf(actor: string): string {
  let hash = 0;
  for (const ch of actor) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

/** The control a key names inside [scope], found the way keyOf made the key. */
export function controlIn(scope: Element, key: string): Element | null {
  return [...scope.querySelectorAll(INTERACTIVE)].find((el) => keyOf(el) === key) ?? null;
}

/**
 * What a control is called, the same in every browser: its own key, else its label, else its text.
 * Not its position, since a leader's row carries controls a member's does not.
 */
export function keyOf(el: Element): string {
  const own = el.getAttribute("data-presence-key") ?? el.getAttribute("aria-label");
  return (own ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
}

/** Where the pointer is, as a ping: its region and the fraction across it, and what it is over. */
export function pingAt(page: string, x: number, y: number, under: Element | null): PresencePing {
  const scope = under?.closest("[data-presence]") ?? null;
  const control = under?.closest(INTERACTIVE) ?? null;
  const target =
    scope && control && control.closest("[data-presence]") === scope ? keyOf(control) : null;
  if (!scope) {
    return { page, here: true, x: x / window.innerWidth, y: y + window.scrollY };
  }
  const box = scope.getBoundingClientRect();
  return {
    page,
    here: true,
    scope: scope.getAttribute("data-presence"),
    x: box.width > 0 ? (x - box.left) / box.width : 0,
    y: box.height > 0 ? (y - box.top) / box.height : 0,
    target,
  };
}

/** Where a peer's cursor goes in this browser's viewport, or null when its region is not on screen. */
export function pointOf(
  peer: Pick<Peer, "scope" | "x" | "y">,
): { left: number; top: number } | null {
  if (peer.x == null || peer.y == null) return null;
  if (!peer.scope) return { left: peer.x * window.innerWidth, top: peer.y - window.scrollY };
  const scope = regionOf(peer.scope);
  if (!scope) return null;
  const box = scope.getBoundingClientRect();
  return { left: box.left + peer.x * box.width, top: box.top + peer.y * box.height };
}

export function regionOf(scope: string): Element | null {
  return document.querySelector(`[data-presence="${CSS.escape(scope)}"]`);
}
