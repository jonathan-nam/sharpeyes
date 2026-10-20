import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

// Same reasoning as header-reservation.test.ts: these files explain the machinery in prose, so an
// assertion against raw source can match the COMMENT rather than the code.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const layoutRaw = readFileSync(join(root, "app", "layout.tsx"), "utf8");
const toggle = stripComments(readFileSync(join(root, "components", "world-toggle.tsx"), "utf8"));
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

/**
 * The veil that covers a world switch.
 *
 * Spread across four files that have to agree on one class name and one storage key, and every way
 * it breaks is silent in one direction or catastrophic in the other. A renamed class means the veil
 * never appears and the switch goes back to flickering; a veil that is never taken down means the
 * app is behind a full-screen cover with no way out, and neither throws.
 */
describe("the world switch veil", () => {
  it("is hidden until the class is on the document", () => {
    // Default-hidden matters: the element ships on every page, so a missing `display: none` puts a
    // full-screen cover over the app permanently.
    expect(css).toMatch(/\.world-veil \{\s*display: none;/);
    expect(css).toMatch(/html\.switching-world \.world-veil \{/);
  });

  it("covers the header it replaces", () => {
    // Above .section-menu and the avatar. Leaving the toggle live under the veil would offer a
    // second switch during the first one.
    const veil = /html\.switching-world \.world-veil \{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(veil).toMatch(/position: fixed/);
    expect(veil).toMatch(/z-index: 100/);
  });

  it("is raised by the toggle before the request, not after it", () => {
    // The save and the reload are two round trips. Raising after them would leave the click with
    // nothing on screen for the part that takes the longest.
    //
    // Within choose() alone: against the whole file this compares to the `saveWorld` IMPORT, which
    // sits above everything and makes the assertion unfailable.
    const choose = /async function choose\([\s\S]*?\n {2}\}/.exec(toggle)?.[0] ?? "";
    expect(choose).toContain("raiseVeil()");
    expect(choose).toContain("saveWorld(");
    expect(choose.indexOf("raiseVeil()")).toBeLessThan(choose.indexOf("saveWorld("));
  });

  it("is lowered again when the switch fails", () => {
    // Nothing changed, so nothing should be covering it. A veil left up over a failed switch is
    // the stuck-forever case, reached without any script bug at all.
    expect(toggle).toContain("lowerVeil()");
  });

  // Runs the string that actually ships, pulled out of layout.tsx, against stand-in globals. A copy
  // of the script here would pass while the shipped one was wrong, which is the whole risk: this
  // cannot throw a visible error, it can only fail to cover or fail to uncover.
  describe("the shipped restore script", () => {
    const source = /const WORLD_VEIL = `([\s\S]*?)`;/.exec(layoutRaw)?.[1];

    type Harness = {
      classes: Set<string>;
      store: Map<string, string>;
      fire: (event: string) => void;
      timeouts: Array<() => void>;
    };

    const run = (flagged: boolean): Harness => {
      const classes = new Set<string>();
      const store = new Map<string, string>();
      if (flagged) store.set("switching-world", "1");
      const listeners = new Map<string, () => void>();
      const timeouts: Array<() => void> = [];
      const doc = {
        documentElement: {
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
          },
        },
      };
      const win = {
        addEventListener: (event: string, fn: () => void) => listeners.set(event, fn),
      };
      const storage = {
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => store.delete(k),
      };
      new Function("document", "window", "sessionStorage", "setTimeout", source ?? "")(
        doc,
        win,
        storage,
        (fn: () => void) => timeouts.push(fn),
      );
      return { classes, store, fire: (e) => listeners.get(e)?.(), timeouts };
    };

    it("was found in layout.tsx", () => expect(source).toBeTruthy());

    it("does nothing at all on an ordinary page load", () => {
      // Every navigation that is not a world switch runs this. Covering one of those would be a
      // full-screen veil over a page nobody asked to reload.
      expect(run(false).classes.has("switching-world")).toBe(false);
    });

    it("covers the page when the flag is set", () => {
      expect(run(true).classes.has("switching-world")).toBe(true);
    });

    it("clears the flag as it reads it, so it cannot cover twice", () => {
      // Left set, the veil would come back on the NEXT navigation, over a page that is not
      // switching anything.
      expect(run(true).store.has("switching-world")).toBe(false);
    });

    it("uncovers on load", () => {
      const h = run(true);
      h.fire("load");
      expect(h.classes.has("switching-world")).toBe(false);
    });

    it("uncovers on the timeout even if load never fires", () => {
      // The backstop, and the reason it exists: a `load` that never arrives would otherwise leave
      // the app behind a cover with no control reachable to clear it.
      const h = run(true);
      expect(h.timeouts.length).toBe(1);
      h.timeouts[0]!();
      expect(h.classes.has("switching-world")).toBe(false);
    });
  });
});
