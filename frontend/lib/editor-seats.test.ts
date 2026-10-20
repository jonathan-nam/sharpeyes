import { describe, expect, it } from "vitest";
import { editorSeats } from "@/lib/parties";
import type { Party } from "@/types/party";

const party = (fields: Partial<Party>) => fields as Party;

describe("editorSeats", () => {
  it("names the seats an Editor acts as", () => {
    const seats = editorSeats(party({ yours: false, role: "EDITOR", yourSeats: ["s1"] }));
    expect([...(seats ?? [])]).toEqual(["s1"]);
  });

  it("is nobody for a Viewer, the owner, or a payload cached from before roles", () => {
    expect(editorSeats(party({ yours: false, role: "VIEWER", yourSeats: ["s1"] }))).toBeNull();
    expect(editorSeats(party({ yours: true, role: "OWNER" }))).toBeNull();
    expect(editorSeats(party({ yours: false }))).toBeNull();
  });
});
