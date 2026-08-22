import { reportApiFailure } from "./report-error";
import { record, serverTimeFromHeader } from "./timing";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// Public, unauthenticated assets: the item icons and the client's digit sprites. that don't go through
// apiFetch's Bearer-token JSON flow, just resolves a backend-relative path
// (e.g. "/token-icons/foo.png") to an absolute URL.
//
// Stamped with a build version (see next.config.ts) so a regenerated icon or digit sprite gets a
// fresh URL and cannot be masked by the day-long cache the backend sets on these, without which a
// changed asset silently serves stale for up to 24h.
const ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION;

export function apiAssetUrl(path: string): string {
  const url = `${API_BASE_URL ?? ""}${path}`;
  if (!ASSET_VERSION) return url;
  return `${url}${path.includes("?") ? "&" : "?"}v=${ASSET_VERSION}`;
}

/**
 * Resolves a character sprite for an `<img>`.
 *
 * Not apiAssetUrl: there is no version stamp, because the backend keys these by a hash of the
 * source URL, which encodes the outfit. The bytes behind a path cannot change, so a stamp would
 * only throw the year-long cache away on every deploy.
 *
 * Every sprite the API sends is one of our own proxy paths, Nexon's URL never leaves the backend.
 */
export function spriteUrl(sprite: string): string {
  return `${API_BASE_URL ?? ""}${sprite}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API request failed (${status}): ${body}`);
  }
}

/**
 * The write landed, and only the read-back after it failed.
 *
 * Its own type because the two cannot be reported the same way. Every write here refetches the list
 * rather than patching it, so the pair reads as one action, and a rejected refetch was shown as
 * "That didn't save." over a row that was already in the database. The picker then kept what was
 * chosen "ready to try again", which is how one Hard Kaling night was logged twice at 60 coupons
 * each: POST 201, both refetches 401 on a stale token, no new row on screen, so it was added again.
 *
 * What failed is the SCREEN. So a caller must say the write landed, and must not re-arm the control
 * that would repeat it.
 */
export class StaleAfterWrite extends Error {
  constructor(readonly reason: unknown) {
    super("saved, but the list could not be read back");
  }
}

/** What every screen says when a write landed and its read-back did not. One wording, one meaning. */
export const SAVED_BUT_STALE = "Saved. Reload to see it.";

/**
 * Reads the list back after a write that has already landed, marking a failure as the screen's.
 *
 * Wrap the refetch, never the write: putting the write inside this would report a POST that never
 * happened as saved, which is the same lie the other way round.
 */
export async function readBack(refetch: () => Promise<unknown>): Promise<void> {
  try {
    await refetch();
  } catch (reason) {
    throw new StaleAfterWrite(reason);
  }
}

// Wraps the fetch + Authorization: Bearer pattern so it is not copy-pasted per
// call site. Takes getToken
// as a plain function argument (from useAuth()) rather than calling the
// hook itself, so this can be called from event handlers (form submit,
// delete click) as well as effects.
export async function apiFetch<T>(
  path: string,
  options: RequestInit,
  getToken: () => Promise<string | null>,
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  }

  // getToken() is timed separately from the fetch on purpose. It happens BEFORE the
  // request goes out, so whatever it costs is latency the user waits through on every
  // single call, and it was completely invisible until we measured it.
  //
  // A null token is interpolated, not refused: `Bearer null` is what goes out. That is a 401 in
  // 2ms, and it is why every page waits for Clerk's `isLoaded` before it fetches. Clerk session
  // tokens live 60s, so any gap in activity leaves the next cold load racing the refresh, and a
  // page that loses that race showed "Couldn't load your parties." over data that was fine. A
  // refusal here instead would only move the same failure into each caller's error branch, which
  // is the screen the wait exists to avoid. Guarded by lib/auth-gate.test.ts.
  const startedAt = performance.now();
  const token = await getToken();
  const authMs = performance.now() - startedAt;

  const fetchedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch (reason) {
    // No response, so the backend has no record this was ever attempted. This report is the only
    // trace a dropped connection or a rejected preflight will leave anywhere.
    reportApiFailure({ kind: "network", path });
    throw reason;
  }
  const roundTripMs = performance.now() - fetchedAt;

  const serverMs = serverTimeFromHeader(response);
  record({
    label: `${options.method ?? "GET"} ${path}`,
    totalMs: performance.now() - startedAt,
    authMs,
    serverMs,
    netMs: serverMs === undefined ? undefined : roundTripMs - serverMs,
  });

  if (!response.ok) {
    reportApiFailure({ kind: "http", path, status: response.status });
    throw new ApiError(response.status, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
