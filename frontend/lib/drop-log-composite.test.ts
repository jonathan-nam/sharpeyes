import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Drop Log asks for its screen once, not eleven times.
//
// Eleven reads for one page was not a round trip problem (prod serves HTTP/2, so they went out
// together and cost about one). It was CPU, which is the resource the 2-vCPU box has least of:
// eleven JWT verifications, `ensureUser` upserts, `inActiveWorld` lookups, transactions and JSON
// payloads. Measured under load, postgres sat at 4% while everything else reached 133% of the 200%
// available.
//
// So the regression to catch is a re-added `apiFetch` on the load path, which reads as harmless and
// is not. The backend half, that the composite answers with the same rows, is guarded in
// backend/.../pages/DropLogPageTest.kt.

const page = readFileSync(join(__dirname, "..", "app", "bosses", "drops", "page.tsx"), "utf8");
const pageType = readFileSync(join(__dirname, "..", "types", "page.ts"), "utf8");
const kotlin = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "backend/src/main/kotlin/com/sharpeyes/backend/pages/DropLogPageResponse.kt",
  ),
  "utf8",
);

const COMPOSITE = "/api/pages/drop-log";

/** The reads the composite now covers. A GET to any of these on this page is the regression. */
const COVERED = [
  "PARTIES_KEY",
  "POOLS_KEY",
  "TRANCHES_KEY",
  "PAYMENTS_KEY",
  "SETTLEMENTS_KEY",
  "DEBTS_KEY",
  "DISPOSALS_KEY",
  "BOSSES_KEY",
  "DROPS_KEY",
  "CHARACTERS_KEY",
  "PEOPLE_KEY",
];

/** Every `apiFetch<...>(KEY, { method: "GET" }, ...)` in the file, by the key it names. */
function getFetchedKeys(): string[] {
  return [...page.matchAll(/apiFetch<[^>]*>\(\s*(\w+),\s*\{\s*method:\s*"GET"/g)].map(
    (m) => m[1] as string,
  );
}

describe("the Drop Log reads its screen in one request", () => {
  it("asks for the composite", () => {
    expect(page).toContain(`const PAGE_KEY = "${COMPOSITE}"`);
    expect(getFetchedKeys()).toContain("PAGE_KEY");
  });

  it("does not also GET the endpoints the composite covers", () => {
    const regressions = getFetchedKeys().filter((k) => COVERED.includes(k));

    expect(
      regressions,
      `these are already in ${COMPOSITE}, so fetching them again is the cost this removed`,
    ).toEqual([]);
  });

  // Both sides of one payload, written by hand in two languages. A field renamed on one side
  // deserialises as absent on the other, which is a screen quietly missing a list rather than an
  // error, so the two are checked against each other rather than trusted to stay in step.
  it("names the same fields as the Kotlin response", () => {
    const kotlinFields = [
      ...(kotlin.match(/data class DropLogPageResponse\(([\s\S]*?)\n\)/)?.[1] ?? "").matchAll(
        /^\s*val (\w+):/gm,
      ),
    ].map((m) => m[1]);
    const tsFields = [
      ...(pageType.match(/export type DropLogPage = \{([\s\S]*?)\n\};/)?.[1] ?? "").matchAll(
        /^\s*(\w+):/gm,
      ),
    ].map((m) => m[1]);

    expect(kotlinFields.length, "could not read the Kotlin response fields").toBeGreaterThan(0);
    expect([...tsFields].sort()).toEqual([...kotlinFields].sort());
  });

  // The keys are still how other pages seed themselves on the way in, so the composite has to fill
  // them. Dropping a `put` would leave a sibling page fetching from cold for no visible reason.
  it("still seeds the cache keys other pages peek at", () => {
    for (const key of ["PARTIES_KEY", "BOSSES_KEY", "DROPS_KEY", "CHARACTERS_KEY", "PEOPLE_KEY"]) {
      expect(page, `${key} is peeked by another page`).toContain(`put(${key},`);
    }
  });
});
