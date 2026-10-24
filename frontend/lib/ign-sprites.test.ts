import { describe, expect, it } from "vitest";
import { isIgn, MAX_IGN_LENGTH } from "@/lib/ign";
import { type Looked, namesToAsk, spriteOf } from "@/lib/ign-sprites";

// Invented names: see CLAUDE.md, "No PII or real IGNs".
const known = (name: string) => (name === "Thornwick" ? "/character-sprites/a.png" : null);

describe("which names are worth asking about", () => {
  it("asks only about IGN-shaped names the page cannot draw and nobody asked about", () => {
    const looked: Looked = new Map([["pellmoor", null]]);
    const asking = new Set(["quillsby"]);
    const names = [
      "Thornwick",
      "Pellmoor",
      "Quillsby",
      "Ravensoot",
      "two words",
      "",
      "x".repeat(MAX_IGN_LENGTH + 1),
    ];
    expect(namesToAsk(names, known, looked, asking)).toEqual(["Ravensoot"]);
  });

  it("asks once for a name typed in two cases", () => {
    expect(namesToAsk(["Ambergast", "ambergast "], known, new Map(), new Set())).toEqual([
      "Ambergast",
    ]);
  });

  it("reads a name as an IGN only within the game's limits", () => {
    expect(isIgn("Ambergast")).toBe(true);
    expect(isIgn(" ")).toBe(false);
    expect(isIgn("x".repeat(MAX_IGN_LENGTH + 1))).toBe(false);
  });
});

describe("a name's sprite", () => {
  it("draws what the page has before what a lookup found", () => {
    const looked: Looked = new Map([
      ["thornwick", "/character-sprites/b.png"],
      ["ravensoot", "/character-sprites/c.png"],
    ]);
    expect(spriteOf("Thornwick", known, looked)).toBe("/character-sprites/a.png");
    expect(spriteOf("RAVENSOOT", known, looked)).toBe("/character-sprites/c.png");
    expect(spriteOf("Pellmoor", known, looked)).toBeNull();
  });
});
