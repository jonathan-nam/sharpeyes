import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The name the browser beacons and the name the backend accepts have to be the same string.
//
// VitalsRoutes.kt drops an unrecognised name on purpose (the endpoint is unauthenticated, so the
// log line is built only from values it recognises), and dropping is silent. That is how
// "inventory-ready" sat in the allowlist with a threshold of its own for months while nothing in
// the frontend ever sent it, and how the one metric that measures what a user waits for came to be
// collected nowhere. A rename on either side is meant to fail here rather than go quiet in prod.
//
// Same reason as the catalog manifest: a name in only one place is drift, and drift is silent.

const vitals = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "backend/src/main/kotlin/com/sharpeyes/backend/plugins/VitalsRoutes.kt",
  ),
  "utf8",
);
const rum = readFileSync(join(__dirname, "rum.ts"), "utf8");

/** The literal set in `private val ALLOWED_NAMES = setOf(...)`. */
function allowedNames(): string[] {
  const set = vitals.match(/ALLOWED_NAMES\s*=\s*setOf\(([^)]*)\)/);
  if (!set?.[1]) throw new Error("could not find ALLOWED_NAMES in VitalsRoutes.kt");
  return [...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/** The keys of the `POOR` map, which is what turns a slow report into a WARN. */
function thresholdedNames(): string[] {
  // [\s\S] rather than . with the dotAll flag, which this tsconfig's target predates.
  const map = vitals.match(/private val POOR\s*=\s*mapOf\(([\s\S]*?)\n\s*\)/);
  if (!map?.[1]) throw new Error("could not find POOR in VitalsRoutes.kt");
  return [...map[1].matchAll(/"([^"]+)" to/g)].map((m) => m[1] as string);
}

describe("rum metric names", () => {
  it("sends a data-ready name the backend accepts", () => {
    const sent = rum.match(/const DATA_READY = "([^"]+)"/)?.[1];
    expect(sent, "lib/rum.ts should define DATA_READY").toBeTruthy();
    expect(allowedNames()).toContain(sent);
  });

  // The same pair of checks for auth-ready, a name of ours for the same reason: nothing on the page
  // can be asked for until a token exists, and that wait had only ever been estimated.
  it("sends an auth-ready name the backend accepts and rates", () => {
    const sent = rum.match(/const AUTH_READY = "([^"]+)"/)?.[1];
    expect(sent, "lib/rum.ts should define AUTH_READY").toBeTruthy();
    expect(allowedNames()).toContain(sent);
    expect(thresholdedNames()).toContain(sent);
  });

  it("gives data-ready a threshold, or a slow load never warns", () => {
    const sent = rum.match(/const DATA_READY = "([^"]+)"/)?.[1];
    expect(thresholdedNames()).toContain(sent);
  });

  // Next's useReportWebVitals decides these at runtime, so they cannot be read off our source.
  // Dropping one from the allowlist would silently stop collecting it.
  it("still accepts every core web vital", () => {
    expect(allowedNames()).toEqual(
      expect.arrayContaining(["LCP", "FCP", "CLS", "INP", "TTFB", "FID"]),
    );
  });

  it("allows nothing it cannot also rate", () => {
    // CLS aside, every allowed name should have a bar. A name with no threshold logs at INFO
    // forever and cannot be grepped as SLOW, which is the only reason the line exists.
    expect(allowedNames().filter((n) => !thresholdedNames().includes(n))).toEqual([]);
  });
});
