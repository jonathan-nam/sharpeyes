import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_COUNT } from "./count-stepper";

// Four sizes, one display size, and two weights, pinned. The scale is only worth having if another
// size costs something, and a stylesheet this size drifts a px at a time with nobody noticing.
// These tests are the cost.
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Comments quote declarations they are explaining, so a raw scan reads those as real rules.
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

type Rule = { selector: string; body: string };

function rules(): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out.push({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" });
  }
  return out;
}

describe("the type scale", () => {
  it("defines exactly four steps and one display size", () => {
    const defined = [...code.matchAll(/--text-([a-z]+):\s*(\d+)px;/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual(["base", "display", "lg", "sm", "xl"]);
  });

  it("keeps the display size to the one line it was made for", () => {
    const users = rules()
      .filter((r) => r.body.includes("var(--text-display)"))
      .map((r) => r.selector);
    expect(users).toEqual([".hero-ign"]);
  });

  it("is the only source of a font size, outside the game window", () => {
    // The inventory window replicates the client at a measured 12/18. Rounding it to our scale
    // would be rounding away the thing it exists to copy, so it keeps its own numbers.
    const raw = rules()
      .filter((r) => !r.selector.includes(".ms-"))
      .filter((r) => /font-size:\s*\d/.test(r.body))
      .map((r) => r.selector);
    expect(raw).toEqual([]);
  });

  it("has no step nobody uses", () => {
    for (const step of ["sm", "base", "lg", "xl"]) {
      expect(code).toContain(`font-size: var(--text-${step})`);
    }
  });
});

describe("bolding", () => {
  it("is one weight, not a gradient of four", () => {
    // 600 and 700 were both in use for the same job, picked per rule rather than per meaning.
    // @font-face is excluded: its font-weight names the range a FILE covers, not a weight the UI
    // asks for, and Maplestory ships Light and Bold rather than 400 and 600.
    const weights = new Set(
      rules()
        .filter((r) => !r.selector.includes("@font-face"))
        .flatMap((r) => [...r.body.matchAll(/font-weight:\s*([^;]+);/g)])
        .map((m) => (m[1] ?? "").trim()),
    );
    expect([...weights].sort()).toEqual(["400", "600"]);
  });
});

describe("the tiny-caps header", () => {
  it("is gone, and stays gone", () => {
    expect(code).not.toMatch(/text-transform:\s*uppercase/);
  });

  it("took its letter-spacing with it", () => {
    // Six different tracking values, none of which was a decision. Nothing left needs any.
    expect(code).not.toMatch(/letter-spacing:/);
  });
});

describe("the corner scale", () => {
  it("defines three steps and a pill", () => {
    const defined = [...code.matchAll(/--radius-([a-z]+):/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual(["lg", "md", "pill", "sm"]);
  });

  it("is the only source of a single-value radius, outside the game window", () => {
    // Same exemption as the type scale, plus .sk-slot: it is the placeholder for .ms-slot, and a
    // placeholder whose corner does not match the slot replacing it is a flicker, not a saving.
    const raw = rules()
      .filter((r) => !/\.ms-|\.sk-slot/.test(r.selector))
      .filter((r) => /border-radius:\s*\d+px;/.test(r.body))
      .map((r) => r.selector);
    expect(raw).toEqual([]);
  });

  it("keeps the pill for states, not for labels and counts", () => {
    // A pill is a claim that the thing is a status you scan a column for. Eight chips were wearing
    // one to mean "this is a chip", which is what the shape stopped being able to say.
    const pills = rules()
      .filter((r) => r.body.includes("var(--radius-pill)"))
      .map((r) => r.selector)
      .sort();
    expect(pills).toEqual([
      ".ledger-bar",
      ".loot-paid",
      ".loot-status",
      ".party-clear",
      ".run-pool",
    ]);
  });
});

describe("the MapleStory face", () => {
  it("dresses the UI, with the system stack still under it", () => {
    const body = rules().find((r) => r.selector === "body");
    expect(body?.body).toMatch(/font-family:\s*"Maplestory",/);
    expect(body?.body).toMatch(/sans-serif/);
  });

  it("draws the digits as well, which is the deliberate part", () => {
    // The face was briefly held off U+30-39 so the figures came from the system stack, which is
    // tabular. One face everywhere was chosen over that, knowing the cost: Maplestory has four
    // different digit advances (60px against 90px over ten glyphs) and no `tnum` to switch on, so
    // `font-variant-numeric: tabular-nums` cannot rescue it. A number that changes in place moves
    // the text beside it. Re-adding a unicode-range here would reverse a decision, not fix a bug.
    const faces = rules().filter((r) => r.selector.includes("@font-face"));
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face.body).not.toMatch(/unicode-range/);
    }
  });

  it("is served as distributed, because the licence says so", () => {
    // Nexon allow free commercial use and web embedding, and forbid modifying the file. That is
    // what rules out subsetting the 480KB down to the Latin this app actually draws.
    for (const face of rules().filter((r) => r.selector.includes("@font-face"))) {
      expect(face.body).toMatch(/Maplestory-(Light|Bold)\.woff2/);
    }
  });

  it("dresses the game window too, Arial having been the odd one out", () => {
    // The client draws its own window in Arial and this replica copied that. It left the one screen
    // dressed as MapleStory as the only one not in MapleStory's face, so the window inherits body
    // now and the face is declared once in the file.
    const win = rules().find((r) => r.selector === ".ms-window");
    expect(win, "no .ms-window rule").toBeDefined();
    expect(win?.body).not.toMatch(/font-family/);
  });

  it("is not opted out of anywhere inside that window", () => {
    // Every rule in here either names no family or says inherit. Naming Arial on one of them puts
    // part of the replica back in a different face from the rest of it.
    const inside = rules().filter((r) => /\.ms-|\.sk-/.test(r.selector));
    expect(inside.length).toBeGreaterThan(0);
    for (const rule of inside) {
      expect(rule.body).not.toContain("Arial");
    }
    const families = inside
      .filter((r) => r.body.includes("font-family"))
      .map((r) => (r.body.match(/font-family:\s*([^;]+)/) ?? [])[1]?.trim());
    for (const fam of families) {
      expect(fam).toBe("inherit");
    }
  });

  it("leaves the count box room for MAX_COUNT in the widest digit", () => {
    // What the ragged advances above cost inside the window. 1ch is the advance of "0", which is
    // the widest digit in this face, so Nch bounds any N-digit value. The box was a fixed 52px,
    // sized to Arial's tabular 6.7px digits, and 1000000 in this face overflowed it and lost its
    // last 0: a million reading as 100000 is the failure this app exists to prevent. Held in ch so
    // it cannot go stale the way a px measurement does.
    const input = rules().find((r) => r.selector === ".ms-count-input");
    const width = (input?.body.match(/width:\s*([\d.]+)ch/) ?? [])[1];
    expect(width, ".ms-count-input width is not in ch").toBeDefined();
    expect(Number(width)).toBeGreaterThanOrEqual(String(MAX_COUNT).length);
  });

  it("reaches the controls, which do not inherit a font on their own", () => {
    // A button, input, select and textarea each take the UA font unless told otherwise. That was
    // being done a rule at a time and 29 were missed, invisibly, while the page font and the UA
    // font were both a system sans. The Drop/Sale/Collection tabs are `.basis-tab` buttons and
    // rendered in the wrong face the moment the body stopped being one.
    const reset = rules().find(
      (r) =>
        /(^|,)\s*button\s*(,|$)/.test(r.selector) &&
        ["input", "select", "textarea"].every((t) =>
          new RegExp(`(^|,)\\s*${t}\\s*(,|$)`).test(r.selector),
        ),
    );
    expect(reset, "no button/input/select/textarea font reset").toBeDefined();
    expect(reset?.body).toMatch(/font:\s*inherit/);
  });
});
