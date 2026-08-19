import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HAS_SESSION_KEY } from "./auth-client";

const root = join(__dirname, "..");

// These files explain this machinery in prose, so an assertion against the raw source matches the
// comment describing the thing rather than the thing. Both of these tests passed against the
// comment alone when first written.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const layoutRaw = readFileSync(join(root, "app", "layout.tsx"), "utf8");
const layout = stripComments(layoutRaw);
const header = stripComments(readFileSync(join(root, "components", "site-header.tsx"), "utf8"));
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

// The header's space reservation is spread across three files that have to agree on two class
// names, and every way it breaks is silent. A renamed class does not error, the reservation just
// stops happening and the brand shifts 54px again when the session resolves, which is the bug this
// machinery exists to prevent and which nothing else would catch.
describe("header control reservation", () => {
  // The selector and class assertions below match to a boundary, not a prefix. `toContain` on the
  // bare name passes against `.header-reservedX`, so a rename in one file only would have slipped
  // through the exact test written to catch it.
  it("sets the class the CSS gates on", () => {
    expect(layout).toContain('classList.add("has-session")');
    expect(css).toMatch(/html:not\(\.has-session\)\s+\.header-reserved\s*\{/);
  });

  it("marks the boxes with the class the CSS hides", () => {
    // Both controls reserve: the hamburger and the avatar.
    expect(header.match(/header-reserved(?![\w-])/g)?.length).toBe(2);
  });

  it("reads the key the client actually writes", () => {
    // Against the exported constant, not a copy of the string. The script is inline source and
    // cannot import it, so this is what stops the writer and the reader drifting apart.
    expect(layout).toContain(HAS_SESSION_KEY);
  });

  // Runs the string that actually ships, pulled out of layout.tsx, against a stand-in store. A
  // copy of the logic here would pass while the shipped one was wrong, which is the whole risk:
  // this script cannot throw a visible error, it can only reserve when it should not or fail to
  // when it should, and both look like a header that shifts.
  describe("the shipped session check", () => {
    const source = /const RESERVE_CONTROLS = `([\s\S]*?)`;/.exec(layoutRaw)?.[1];

    const run = (stored: Record<string, string>) => {
      const classes: string[] = [];
      const localStorage = { getItem: (k: string) => stored[k] ?? null };
      const document = { documentElement: { classList: { add: (c: string) => classes.push(c) } } };
      new Function("localStorage", "document", source ?? "")(localStorage, document);
      return classes.includes("has-session");
    };

    it("was found in layout.tsx", () => expect(source).toBeTruthy());

    it("reserves when a session was last seen", () => {
      expect(run({ [HAS_SESSION_KEY]: "1" })).toBe(true);
    });

    it("does not reserve when nothing was stored", () => {
      expect(run({})).toBe(false);
    });

    it("does not reserve off some other key", () => {
      expect(run({ "some.other.flag": "1" })).toBe(false);
    });

    it("survives a store that throws, which privacy modes do", () => {
      const classes: string[] = [];
      const localStorage = {
        getItem: () => {
          throw new Error("denied");
        },
      };
      const document = { documentElement: { classList: { add: (c: string) => classes.push(c) } } };
      expect(() =>
        new Function("localStorage", "document", source ?? "")(localStorage, document),
      ).not.toThrow();
      expect(classes).toHaveLength(0);
    });
  });

  it("keeps the routes prerenderable", () => {
    // The whole point of reading this in the browser. A cookies() call here opts every route into
    // dynamic rendering, which also drops the client router's staleTime to 0 so no navigation can
    // be served from cache. Reintroducing it would undo that invisibly: the build still succeeds
    // and the pages still work, they are just all dynamic again.
    expect(layout).not.toContain("next/headers");
    expect(layout).not.toContain("cookies()");
  });
});
