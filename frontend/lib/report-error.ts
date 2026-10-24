import { beacon, reportContext } from "./rum";

// Report a failed API call to the backend, so "it errored for me" is a log query rather than a
// request to reproduce it.
//
// The server already logs its own non-2xx responses (see Timing.kt). This exists for the half it
// cannot see: a CORS rejection, a dropped connection, a backend that never answered. That half has
// cost real time twice, once as a stub that failed a preflight and left every frame of a trace
// showing the error state, and once as a burst of 401s nobody could attribute afterwards.

// Per page load, not per session. A page that retries on failure must not turn one broken backend
// into a log flood, and the first few reports say everything the hundredth would.
const MAX_REPORTS_PER_LOAD = 10;

let sent = 0;

/**
 * True at most MAX_REPORTS_PER_LOAD times, then false for the rest of the page load.
 *
 * Separate from the reporting itself so the cap can be tested without a DOM, which is the whole
 * of what this module can get wrong on its own.
 */
export function withinReportCap(): boolean {
  if (sent >= MAX_REPORTS_PER_LOAD) return false;
  sent += 1;
  return true;
}

// Test seam. Nothing else may reset the cap.
export function resetErrorReportsForTest(): void {
  sent = 0;
}

export type ApiFailure = {
  // "http" got a response and it was not ok. "network" got no response at all.
  kind: "http" | "network";
  path: string;
  status?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Drop the ids out of a path, keeping its shape.
 *
 * This telemetry is anonymous the same way the vitals beacon is, and a party id in a log line is
 * the one field that would stop being true of it. `/api/parties/<uuid>/loot` is also the more
 * useful thing to count: the interesting question is which endpoint is failing, not which row.
 */
export function endpointShape(path: string): string {
  const [withoutQuery = path] = path.split("?");
  return withoutQuery
    .split("/")
    .map((segment) => (UUID.test(segment) || /^\d+$/.test(segment) ? ":id" : segment))
    .join("/");
}

/** The browser's money and the server's disagreed: where first, and in how many places. No values. */
export function reportParity(field: string, count: number): void {
  if (typeof window === "undefined") return;
  if (!withinReportCap()) return;

  beacon("/api/errors", {
    kind: "parity",
    field: field.slice(0, 160),
    count,
    route: location.pathname,
    ...reportContext(),
  });
}

export function reportApiFailure(failure: ApiFailure): void {
  if (typeof window === "undefined") return;
  if (!withinReportCap()) return;

  beacon("/api/errors", {
    ...failure,
    path: endpointShape(failure.path),
    route: location.pathname,
    ...reportContext(),
  });
}
