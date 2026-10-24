import { describe, expect, it } from "vitest";
import { isIgn, MAX_IGN_LENGTH } from "@/lib/ign";
import { jobOf, type Looked, namesToAsk, spriteOf } from "@/lib/ign-sprites";

// Invented names: see CLAUDE.md, "No PII or real IGNs".
const known = (name: string) => (name === "Thornwick" ? "/character-sprites/a.png" : null);
const knownJob = (name: string) => (name === "Quillsby" ? "Hero" : null);
const none = { sprite: null, job: null };

describe("which names are worth asking about", () => {
  it("asks only about IGN-shaped names the page cannot draw and nobody asked about", () => {
    const looked: Looked = new Map([["pellmoor", none]]);
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

  it("asks about a drawn name whose job the page needs and does not have", () => {
    // Thornwick has a sprite but no job; Quillsby has a job but no sprite.
    const asked = namesToAsk(["Thornwick", "Quillsby"], known, new Map(), new Set(), knownJob);
    expect(asked).toEqual(["Thornwick", "Quillsby"]);
    // Without a job resolver, a drawn name needs nothing.
    expect(namesToAsk(["Thornwick"], known, new Map(), new Set())).toEqual([]);
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

describe("a name's sprite and job", () => {
  const looked: Looked = new Map([
    ["thornwick", { sprite: "/character-sprites/b.png", job: "Lynn" }],
    ["ravensoot", { sprite: "/character-sprites/c.png", job: "Lynn" }],
  ]);

  it("draws what the page has before what a lookup found", () => {
    expect(spriteOf("Thornwick", known, looked)).toBe("/character-sprites/a.png");
    expect(spriteOf("RAVENSOOT", known, looked)).toBe("/character-sprites/c.png");
    expect(spriteOf("Pellmoor", known, looked)).toBeNull();
  });

  it("takes the page's job before a lookup's, and a lookup's where the page has none", () => {
    expect(jobOf("Quillsby", knownJob, looked)).toBe("Hero");
    expect(jobOf("Ravensoot", knownJob, looked)).toBe("Lynn");
    expect(jobOf("Pellmoor", knownJob, looked)).toBeNull();
  });
});
