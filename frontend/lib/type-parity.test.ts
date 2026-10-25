import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// types/generated/parity.ts makes tsc fail when a hand-written type drifts from what shared/api
// serves. It only checks the types it names, so a type added to types/ without a line there would
// drift unseen. This fails until it has one.

const TYPES = join(__dirname, "..", "types");
const parity = readFileSync(join(TYPES, "generated", "parity.ts"), "utf8");

/** Mixins spread into other types, which those types' lines already cover. */
const MIXINS = new Set(["WrittenBy", "ClosePots"]);

function objectTypes(): string[] {
  return readdirSync(TYPES)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) =>
      [
        ...readFileSync(join(TYPES, f), "utf8").matchAll(/^export type (\w+) = (?:\w+ & )?\{/gm),
      ].map((m) => m[1] as string),
    );
}

describe("types/generated/parity.ts", () => {
  it("checks every object type in types/", () => {
    const unchecked = objectTypes().filter(
      (name) => !MIXINS.has(name) && !new RegExp(`<\\s*${name},`).test(parity),
    );
    expect(unchecked).toEqual([]);
  });

  it("finds the types it is guarding", () => {
    // A pattern that matched nothing would pass the test above against an empty list.
    expect(objectTypes()).toEqual(
      expect.arrayContaining(["Party", "Loot", "VestigeTranche", "SavePartyBody"]),
    );
  });
});
