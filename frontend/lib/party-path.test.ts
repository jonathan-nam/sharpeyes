import { describe, expect, it } from "vitest";
import { partyHref, partyHrefById } from "./party-path";

const party = (id: string, slug: string) => ({ id, slug });

describe("where a config's page is", () => {
  it("addresses it by the character and the boss", () => {
    expect(partyHref(party("pa", "tidelark/kalos-the-guardian"))).toBe(
      "/bosses/parties/tidelark/kalos-the-guardian",
    );
  });

  it("says whatever the config says, including the id it falls back to", () => {
    // A character whose name another of yours shares has no readable form, and the server sends the
    // id as the slug. Rebuilding a prettier one here would be a second answer to "which character
    // is Rune". See backend PartySlug.kt.
    const id = "3f2a5c7e-0000-4000-8000-000000000001";
    expect(partyHref(party(id, id))).toBe(`/bosses/parties/${id}`);
  });

  it("resolves a row's party through the list it was drawn with", () => {
    const rune = party("pa", "rune/baldrix");
    const byId = new Map([[rune.id, rune]]);

    expect(partyHrefById("pa", byId)).toBe("/bosses/parties/rune/baldrix");
  });

  it("falls back to the id for a party that list does not hold", () => {
    // A retired config a row still points at, drawn from a list that leaves those out. The page
    // takes an id too, so the link is uglier and not broken.
    expect(partyHrefById("pa", new Map())).toBe("/bosses/parties/pa");
  });
});
