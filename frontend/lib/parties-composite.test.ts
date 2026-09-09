import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Party View asks for its screen in two requests, not nine.
//
// Two rather than one, and that is the interesting part. Six of the nine reads were
// `.catch(() => null)`, each with a comment saying what degrades without it, so one request for all
// nine would have traded documented resilience for latency. Per-field recovery inside one request
// does not work either: Postgres aborts a transaction on a failed statement.
//
// The regression to catch is a re-added `apiFetch` on the load path, which reads as harmless. The
// backend half, that the two answer with the same rows, is guarded in PartiesPageTest.kt.

const page = readFileSync(join(__dirname, "..", "app", "bosses", "parties", "page.tsx"), "utf8");
const pageType = readFileSync(join(__dirname, "..", "types", "parties-page.ts"), "utf8");
const kotlin = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "backend/src/main/kotlin/com/sharpeyes/backend/pages/PartiesPageResponse.kt",
  ),
  "utf8",
);

/** Reads the composites cover. A GET to one of these on the load path is the regression. */
const COVERED = [
  "BOSSES_KEY",
  "CHARACTERS_KEY",
  "SEATED_KEY",
  "PEOPLE_KEY",
  "DROPS_KEY",
  "POOLS_KEY",
  "SETTLEMENTS_KEY",
];

/** Kotlin `val name:` inside a named data class, and TypeScript `name:` inside a named type. */
function kotlinFields(name: string): string[] {
  const body = kotlin.match(new RegExp(`data class ${name}\\(([\\s\\S]*?)\\n\\)`))?.[1] ?? "";
  return [...body.matchAll(/^\s*val (\w+):/gm)].map((m) => m[1] as string);
}

function tsFields(name: string): string[] {
  const body =
    pageType.match(new RegExp(`export type ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? "";
  return [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1] as string);
}

describe("Party View reads its screen in two requests", () => {
  it("asks for both composites", () => {
    expect(page).toContain('const PAGE_KEY = "/api/pages/parties"');
    expect(page).toContain('const EXTRAS_KEY = "/api/pages/parties/extras"');
    expect(page).toContain("apiFetch<PartiesPage>(PAGE_KEY");
    expect(page).toContain("apiFetch<PartiesExtras>(EXTRAS_KEY");
  });

  // Only the LOAD path. Refetching after a write still uses the individual endpoints, and should:
  // a write refreshes what it changed rather than re-reading the whole screen. See refreshPools.
  it("does not also GET the reads the composites cover, on load", () => {
    const start = page.indexOf("const ticket = ++latestWeek.current;");
    const end = page.indexOf("}, [isLoaded]);", start);
    expect(start, "could not find the load effect").toBeGreaterThan(-1);
    expect(end, "could not find the end of the load effect").toBeGreaterThan(start);

    const loadPath = page.slice(start, end);
    const fetched = [
      ...loadPath.matchAll(/apiFetch<[^>]*>\(\s*(\w+),\s*\{\s*method:\s*"GET"/g),
    ].map((m) => m[1] as string);

    expect(fetched.filter((k) => COVERED.includes(k))).toEqual([]);
    expect(fetched.sort()).toEqual(["EXTRAS_KEY", "PAGE_KEY"]);
  });

  // Stepping to a past week still uses the individual endpoints, on purpose: that is a click
  // needing two reads, not a page load needing nine. So the week-aware URLs must survive.
  it("still reads a past week through the individual endpoints", () => {
    expect(page).toContain("clearsUrl(target)");
    expect(page).toContain("partiesUrl(target)");
  });

  // The optional half must stay optional. Losing it costs the drop picker, the roster editor's
  // suggestions and a row's coupons figure; making it required would blank the page over them.
  it("still lets the extras fail without failing the page", () => {
    expect(page).toMatch(
      /apiFetch<PartiesExtras>\(EXTRAS_KEY[\s\S]{0,120}?\.catch\(\(\) => null\)/,
    );
  });

  // A field renamed on one side deserialises as absent on the other, which is a screen quietly
  // missing a list rather than an error.
  it("names the same fields as the Kotlin responses", () => {
    for (const [ts, kt] of [
      ["PartiesPage", "PartiesPageResponse"],
      ["PartiesExtras", "PartiesExtrasResponse"],
    ] as const) {
      const fromKotlin = kotlinFields(kt);
      expect(fromKotlin.length, `could not read ${kt}'s fields`).toBeGreaterThan(0);
      expect([...tsFields(ts)].sort(), `${ts} vs ${kt}`).toEqual([...fromKotlin].sort());
    }
  });

  // The split is a decision, not an accident: everything the page cannot draw without on one side.
  it("keeps the required half to what the page cannot draw without", () => {
    expect(kotlinFields("PartiesPageResponse").sort()).toEqual(["bosses", "characters", "parties"]);
  });
});
