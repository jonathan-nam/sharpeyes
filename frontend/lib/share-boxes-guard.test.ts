import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The share boxes must be gated on a count read through the WORLD, and on nothing else.
//
// They vanished from every party that had a mode set, and nothing failed. A third condition in
// front of the two real ones asked the same question again and got it wrong: it read
// `pieces[difficulty]` from a map the world had since been put on top of (V63). Indexing a
// Record<world, Record<difficulty, number>> by a difficulty yields a whole world's map, which is
// never undefined and never a number, and comparing it to undefined is legal TypeScript. So the
// compiler had nothing to say and the control simply went.
//
// Not reachable from a unit test: it is a render condition in a component, and there is no render
// harness in this repo. So this reads the source, the same approach piece-row-guard.test.ts and
// drops-section.test.ts take, and the alternative is nothing checking it at all.
//
// COMMENTS ARE STRIPPED FIRST, which the first draft of this did not do. Both of its assertions
// matched the prose written to explain the bug rather than any code, so a file could describe the
// mistake and still commit it. None of the files below contain a "//" inside a string literal,
// which is what makes stripping them this bluntly safe.

const code = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ");

const editor = code("components", "party-config-editor.tsx");

describe("the share boxes read the world before the difficulty", () => {
  it("takes both figures through the party's world", () => {
    expect(editor).toContain("const world = party.worldType;");
    expect(editor).toContain("const bundlesForEdit = dividing?.bundles?.[world]?.[difficulty];");
    expect(editor).toContain("const total = dividing?.pieces?.[world]?.[difficulty];");
  });

  it("gates the boxes on those two and nothing else", () => {
    // A third condition is what broke it once. These two already require a real count at this boss,
    // this mode and this world, so anything in front of them is a second answer to one question.
    expect(editor).toContain(
      "const showBoxes = bundlesForEdit !== undefined && total !== undefined;",
    );
    expect(editor).toContain("{showBoxes && (");
    expect(editor).not.toContain("dropsVestige");
  });

  it("judges the typed boxes only where boxes are drawn", () => {
    // A blank box is not an answer, and every box is blank when none are drawn. Ungated, this was
    // true for every party whose boss divides nothing, so Black Mage had Save disabled for ever on
    // a form with no boxes to fix.
    expect(editor).toContain("const badStacks = showBoxes && halves.some((n) => n === null);");
  });

  it("passes the stored ratio back when nobody typed in the boxes", () => {
    // The boxes cannot always SHOW the stored ratio: 2:1 over 14 pieces does not land on whole
    // half-stacks, so they open on the even split. Deriving from that on every save turned editing
    // a party's minutes into a silent rewrite of its deal.
    expect(editor).toContain("stacksDirty ?");
    expect(editor).toContain("savedShares.get(name) ?? 1");
  });

  it("indexes no amount map by a difficulty alone, anywhere that reads one", () => {
    // The shape of the mistake rather than the single instance of it. `pieces` and `bundles` are
    // keyed by world and THEN by difficulty, so a one-level read is either a bug or a whole world's
    // map being used as a number. Every real read names a world first.
    const readers = [
      ["components", "party-config-editor.tsx"],
      ["lib", "drop-picker.ts"],
      ["lib", "vestige-stacks.ts"],
      ["lib", "parties.ts"],
      ["lib", "drop-log.ts"],
    ];
    for (const file of readers) {
      expect(
        code(...file),
        `${file.join("/")} indexes an amount map by difficulty alone`,
      ).not.toMatch(/\.(pieces|bundles)\??\.?\[\s*(difficulty|party\.difficulty)/);
    }
  });

  it("still sees the code it is checking, with the comments gone", () => {
    // The stripper is the load-bearing part of this file, so it is checked rather than trusted: a
    // regex that ate everything would make every assertion above pass by matching nothing.
    expect(editor).toContain("const dividingAt = (mode: string): BossDrop | undefined => {");
    expect(editor).not.toContain("Do not reintroduce");
  });
});
