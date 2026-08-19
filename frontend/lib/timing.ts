// Where the time actually goes, on the client.
//
// The backend answers in single-digit milliseconds, so when a page "feels slow" the
// cost is somewhere between the click and the paint, and that is the one stretch
// nobody was measuring. This records it, and prints it, so a hunch becomes a number.
//
// Three things are worth telling apart, and a single "the request took 300ms" hides
// all of them:
//
//   auth    getToken() from the auth service. It can hit the network, and it happens BEFORE the
//           fetch, so it is pure latency the user waits through, on every call.
//   server  the backend's own work, read from its Server-Timing header. Usually ~1ms.
//   net     round trip minus server. Connection setup, transfer, the browser's own
//           queueing.
//
// Enabled in development, and in production only when localStorage.perf is set, so
// nobody pays for instrumentation they did not ask for.

const ENABLED =
  process.env.NODE_ENV !== "production" ||
  (typeof window !== "undefined" && window.localStorage?.getItem("perf") === "1");

export type Timing = {
  label: string;
  totalMs: number;
  authMs?: number;
  serverMs?: number;
  netMs?: number;
};

const recent: Timing[] = [];
const MAX_RECENT = 50;

export function record(t: Timing): void {
  if (!ENABLED) return;

  recent.push(t);
  if (recent.length > MAX_RECENT) recent.shift();

  const parts = [`${t.totalMs.toFixed(0)}ms`];
  if (t.authMs !== undefined) parts.push(`auth ${t.authMs.toFixed(0)}ms`);
  if (t.serverMs !== undefined) parts.push(`server ${t.serverMs.toFixed(1)}ms`);
  if (t.netMs !== undefined) parts.push(`net ${t.netMs.toFixed(0)}ms`);

  // Slow enough to notice gets a warning, so it stands out without a dashboard.
  const slow = t.totalMs > 500;
  const line = `[perf] ${t.label}. ${parts.join(", ")}`;
  if (slow) console.warn(line);
  else console.debug(line);
}

/**
 * Pull the backend's own timing out of its Server-Timing header.
 *
 * Requires the backend to expose the header cross-origin (see Cors.kt). Without
 * that, the browser shows it in DevTools but hands JavaScript null, and we would
 * silently attribute the backend's time to the network.
 */
export function serverTimeFromHeader(res: Response): number | undefined {
  const header = res.headers.get("Server-Timing");
  if (!header) return undefined;
  const total = header.split(",").find((p) => p.trim().startsWith("total"));
  const dur = total?.match(/dur=([\d.]+)/)?.[1];
  return dur ? Number(dur) : undefined;
}

/** Time an arbitrary async step. Returns whatever the block returns. */
export async function timed<T>(label: string, block: () => Promise<T>): Promise<T> {
  if (!ENABLED) return block();
  const start = performance.now();
  try {
    return await block();
  } finally {
    record({ label, totalMs: performance.now() - start });
  }
}

if (typeof window !== "undefined" && ENABLED) {
  (window as unknown as { __perf: () => void }).__perf = () => {
    console.table(recent);
  };
}
