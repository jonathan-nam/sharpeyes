import { record } from "./timing";

// Real User Monitoring: report page-load metrics from real browsers to the backend, so
// "how slow is the site for actual users, and from where" is a log query rather than a
// guess made on a developer's fast local connection.
//
// This is the production-facing sibling of timing.ts. timing.ts prints per-request
// splits to the dev console; this beacons a small, anonymous payload to /api/vitals for
// every (sampled) real load. No user id, no IP: location is coarse (timezone, locale),
// which answers "slow loads come from Australia" without logging who.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION;

// Fraction of page loads that report. 1 = everyone. Env-tunable so a traffic spike can
// be dialled down without shipping code.
const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE ?? "1");

// Decided ONCE per page load, not per metric. A sampled-in load must report all of its
// metrics or the per-load picture is half-missing, and web-vitals arrive at different
// times (some only on pagehide).
const sampledIn = typeof window !== "undefined" && Math.random() < SAMPLE_RATE;

export type Metric = {
  name: string;
  value: number;
  rating?: string;
  id?: string;
};

// Where the current navigation started, and whether it was a client-side one. Zero is the
// document's own navigation start, which is what performance.now() already counts from.
let navStartedAt = 0;
let softNav = false;
let reportedDataReady = false;

// The coarse, anonymous context every report carries. Read fresh per report: connection
// and route can both change during a session. Shared with report-error.ts, which reports
// the same load from the same browser and would otherwise describe it differently.
export function reportContext(navOverride?: string) {
  // The document's own navigation type, which is what a core web vital measures however many
  // client-side navs happened since. Only a caller that is timing the nav itself overrides this:
  // useReportWebVitals re-delivers buffered LCP and TTFB on every route change, so labelling them
  // all "soft" would claim the document's numbers belonged to the last click.
  const nav =
    navOverride ??
    (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
      ?.type;
  // Non-standard but widely shipped; absent on Safari/Firefox, hence optional.
  const conn = (navigator as { connection?: { effectiveType?: string } }).connection?.effectiveType;
  const device = window.matchMedia("(max-width: 768px)").matches ? "mobile" : "desktop";
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Older engines without a tz database; skip it rather than fail the report.
  }
  return { nav, conn, device, tz, lang: navigator.language, v: ASSET_VERSION };
}

/** The backend allows this name explicitly (VitalsRoutes.kt), so the two have to agree. */
const DATA_READY = "data-ready";

/**
 * The path the document was opened on, read once at module load.
 *
 * Which is what makes the guard below survive StrictMode: it double-invokes mount effects, so a
 * ref counting mounts reports the landed-on page as a navigation to itself and measures it from the
 * remount instead of from navigation start. A URL cannot be double-invoked.
 */
const landedPath = typeof location === "undefined" ? null : location.pathname;

/**
 * A client-side route change: a new page, and a new zero to measure it from.
 *
 * Without this the mark could only be trusted on the page that was landed on, because a page
 * reached by a nav would be timed from the document's navigation start and so report the whole
 * session. Most loads here are client-side navs, which would leave the metric technically present
 * and practically empty, the state it was already in.
 */
export function markSoftNavigation(path: string): void {
  if (typeof performance === "undefined") return;
  // The first commit names the page we landed on, which is already zeroed at navigation start.
  // Only skipped while that is still the current navigation, so coming BACK to it later counts.
  if (!softNav && path === landedPath) return;
  navStartedAt = performance.now();
  softNav = true;
  reportedDataReady = false;
}

/**
 * The moment the numbers on screen are real.
 *
 * Every web vital scored a /bosses/drops load "good" (LCP 685ms) while its sixteen API calls did
 * not finish for about 2.8s, because LCP times the skeleton painting and stops there. So the wait
 * users actually complain about was the one thing nothing measured.
 *
 * Once per navigation. A page refetches on write and this must not report that as a fresh load.
 */
export function reportDataReady(): void {
  if (reportedDataReady || typeof performance === "undefined") return;
  reportedDataReady = true;
  // No rating: the bar lives in the backend's POOR table so there is one place to move it.
  // The two kinds of load must not pool, so a soft one says so: a hard load carries the document
  // and the JS, a soft one is the data fan-out alone.
  reportVital(
    { name: DATA_READY, value: performance.now() - navStartedAt },
    softNav ? "soft" : undefined,
  );
}

export function reportVital(metric: Metric, navOverride?: string): void {
  const route = typeof location !== "undefined" ? location.pathname : undefined;

  // Mirror into the dev console + window.__perf() buffer, on the same gate as every
  // other timing (dev, or localStorage.perf). value is ms for the timing metrics; CLS
  // is unitless, so the console number there is nominal.
  record({ label: `vital ${metric.name} (${route ?? "?"})`, totalMs: metric.value });

  if (!sampledIn) return;

  beacon("/api/vitals", { ...metric, route, ...reportContext(navOverride) });
}

/**
 * Post a small anonymous payload, best-effort.
 *
 * text/plain, not application/json: a CORS-safelisted content type sends without a preflight,
 * which is what makes the beacon survive being fired as the page unloads.
 */
export function beacon(path: string, payload: unknown): void {
  if (!API_BASE_URL || typeof navigator === "undefined" || !navigator.sendBeacon) return;
  try {
    navigator.sendBeacon(
      `${API_BASE_URL}${path}`,
      new Blob([JSON.stringify(payload)], { type: "text/plain" }),
    );
  } catch {
    // Telemetry is best-effort and must never throw into the app it measures.
  }
}
